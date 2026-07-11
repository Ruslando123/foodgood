import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "./db";
import { paymentProvider } from "./payments";
import { generatePickupCode } from "./qr";
import { PLATFORM_FEE_PCT } from "./config";
import { sendTelegramMessage } from "./telegram";

export class OrderError extends Error {}

type FinalRefundStatus = "CANCELLED" | "EXPIRED";

/**
 * Ленивое истечение для MVP. Операция идемпотентна: завершённые возвраты больше
 * не попадают в выборку, а неуспешные остаются в REFUND_PENDING для повторной
 * попытки при следующем запуске.
 */
export async function expireStale(): Promise<void> {
  const now = new Date();

  await prisma.bag.updateMany({
    where: { status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupEnd: { lt: now } },
    data: { status: "EXPIRED" },
  });
  await prisma.order.updateMany({
    where: { status: "PENDING_PAYMENT", bag: { pickupEnd: { lt: now } } },
    data: { status: "EXPIRED" },
  });

  const staleOrders = await prisma.order.findMany({
    where: { status: "PAID", bag: { pickupEnd: { lt: now } } },
    include: { payment: true },
  });
  for (const order of staleOrders) {
    try {
      await refundIfClaimed(order.id, order.payment?.id, "EXPIRED");
    } catch (error) {
      console.error("Could not refund expired order", { orderId: order.id, error });
    }
  }

  await retryPendingRefunds();
}

/** Покупка: резерв остатка → hold → фиксация PAID только для активного пакета. */
export async function createOrder(userId: string, bagId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new OrderError("Некорректное количество");
  }

  const order = await prisma.$transaction(async (tx) => {
    const bag = await tx.bag.findUnique({ where: { id: bagId } });
    if (!bag || bag.status !== "ACTIVE") throw new OrderError("Пакет недоступен");
    if (bag.pickupEnd <= new Date()) throw new OrderError("Окно выдачи уже закончилось");

    const reserved = await tx.bag.updateMany({
      where: { id: bagId, status: "ACTIVE", quantityLeft: { gte: quantity } },
      data: { quantityLeft: { decrement: quantity } },
    });
    if (reserved.count === 0) throw new OrderError("Столько пакетов уже не осталось");

    const updated = await tx.bag.findUniqueOrThrow({ where: { id: bagId } });
    if (updated.quantityLeft === 0) {
      await tx.bag.update({ where: { id: bagId }, data: { status: "SOLD_OUT" } });
    }

    const totalPrice = bag.price * quantity;
    const created = await createOrderRowWithUniqueCode(tx, {
      bagId,
      userId,
      quantity,
      totalPrice,
      platformFee: Math.round(totalPrice * PLATFORM_FEE_PCT),
    });
    const payment = await tx.payment.create({
      data: { orderId: created.id, provider: paymentProvider.name, amount: totalPrice },
    });
    await tx.paymentOperation.create({
      data: { paymentId: payment.id, type: "HOLD", idempotencyKey: randomUUID(), nextAttemptAt: new Date(0) },
    });
    return created;
  });

  await reconcilePendingPayments(1, `request-${randomUUID()}`);

  return prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { bag: { include: { venue: true } }, payment: true },
  });
}

/** Отмена покупателем до начала окна выдачи: refund + возврат остатка. */
export async function cancelOrder(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true, bag: true },
  });
  if (!order || order.userId !== userId) throw new OrderError("Заказ не найден");
  if (order.status !== "PAID") throw new OrderError("Заказ нельзя отменить");
  if (order.bag.pickupStart <= new Date()) {
    throw new OrderError("Окно выдачи уже началось — отмена недоступна");
  }

  const cancelled = await refundIfClaimed(order.id, order.payment?.id, "CANCELLED");
  if (!cancelled) throw new OrderError("Заказ уже обрабатывается");
  await reconcilePendingPayments(1, `request-${randomUUID()}`);
  const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  if (settled.status === "CANCELLED") await releaseQuantity(order.bagId, order.quantity);
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { bag: { include: { venue: true } }, payment: true },
  });
}

/** Выдача на кассе по pickup-коду: capture холда → COMPLETED. */
export async function redeemOrder(merchantId: string, pickupCode: string) {
  const order = await prisma.order.findUnique({
    where: { pickupCode: pickupCode.trim().toUpperCase() },
    include: { payment: true, bag: { include: { venue: true } }, user: true },
  });
  if (!order) throw new OrderError("Код не найден");
  if (order.bag.venue.ownerId !== merchantId) {
    throw new OrderError("Код от другого заведения");
  }
  if (order.status === "COMPLETED") throw new OrderError("Заказ уже выдан");
  if (order.status === "CAPTURE_PENDING") {
    throw new OrderError("Списание уже обрабатывается, проверьте статус позже");
  }
  if (order.status !== "PAID") throw new OrderError("Заказ не оплачен или отменён");
  if (!order.payment) throw new OrderError("Для заказа не найден платёж");
  const payment = order.payment;
  if (!payment.providerRef) throw new OrderError("Для заказа не найден reference платежа");
  const captureOperation = await ensureOperation(payment.id, "CAPTURE");

  // Не выдаём товар до успешного capture: при сбое статус остаётся
  // CAPTURE_PENDING и его можно сверить с платёжным провайдером.
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: "PAID" },
    data: { status: "CAPTURE_PENDING" },
  });
  if (claimed.count === 0) throw new OrderError("Заказ уже обрабатывается");

  void captureOperation;
  await reconcilePendingPayments(1, `request-${randomUUID()}`);
  return prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { bag: { include: { venue: true } }, payment: true, user: true },
  });
}

/** Снятие пакета с продажи: pending-заказы отменяются, paid — возвращаются. */
export async function cancelBagWithRefunds(merchantId: string, bagId: string) {
  const bag = await prisma.bag.findUnique({ where: { id: bagId }, include: { venue: true } });
  if (!bag || bag.venue.ownerId !== merchantId) throw new OrderError("Пакет не найден");

  await prisma.$transaction([
    prisma.bag.update({ where: { id: bagId }, data: { status: "CANCELLED" } }),
    prisma.order.updateMany({
      where: { bagId, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED" },
    }),
  ]);

  const paidOrders = await prisma.order.findMany({
    where: { bagId, status: "PAID" },
    include: { payment: true, user: true },
  });
  for (const order of paidOrders) {
    try {
      const cancelled = await refundIfClaimed(order.id, order.payment?.id, "CANCELLED");
      if (cancelled && order.user.telegramId) {
        await sendTelegramMessage(
          order.user.telegramId,
          `😔 «${bag.venue.name}» отменил пакет «${bag.title}». Деньги вернутся на карту.`
        );
      }
    } catch (error) {
      console.error("Could not refund cancelled bag order", { orderId: order.id, error });
    }
  }
  await reconcilePendingPayments(50, `request-${randomUUID()}`);

  return prisma.bag.findUniqueOrThrow({ where: { id: bagId }, include: { venue: true } });
}

/** Переводит PAID в REFUND_PENDING и завершает возврат только после успеха шлюза. */
async function refundIfClaimed(
  orderId: string,
  paymentId: string | undefined,
  finalStatus: FinalRefundStatus
): Promise<boolean> {
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: "PAID" },
    data: { status: "REFUND_PENDING", refundTargetStatus: finalStatus },
  });
  if (claimed.count === 0) return false;
  if (paymentId) await ensureOperation(paymentId, "REFUND");
  return true;
}

async function confirmHeldPayment(
  orderId: string
): Promise<{ confirmed: true } | { confirmed: false; finalStatus: FinalRefundStatus }> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      include: { bag: true },
    });
    if (!current) throw new OrderError("Заказ не найден");

    if (
      current.status === "PENDING_PAYMENT" &&
      (current.bag.status === "ACTIVE" || current.bag.status === "SOLD_OUT") &&
      current.bag.pickupEnd > new Date()
    ) {
      await tx.order.update({ where: { id: orderId }, data: { status: "PAID" } });
      return { confirmed: true };
    }

    const finalStatus: FinalRefundStatus =
      current.bag.pickupEnd <= new Date() ? "EXPIRED" : "CANCELLED";
    const queued = await tx.order.updateMany({
      where: { id: orderId, status: { in: ["PENDING_PAYMENT", "CANCELLED", "EXPIRED"] } },
      data: { status: "REFUND_PENDING", refundTargetStatus: finalStatus },
    });
    if (queued.count === 0 && current.status !== "REFUND_PENDING") {
      throw new OrderError("Заказ уже обрабатывается");
    }
    return { confirmed: false, finalStatus };
  });
}

async function settleRefund(
  orderId: string,
  paymentId: string | undefined,
  finalStatus: FinalRefundStatus
): Promise<boolean> {
  const payment = paymentId ? await prisma.payment.findUnique({ where: { id: paymentId } }) : null;
  const refundOperation = payment ? await ensureOperation(payment.id, "REFUND") : null;
  try {
    if (payment?.status === "HELD" && payment.providerRef && refundOperation) {
      await paymentProvider.refund(payment.providerRef, refundOperation.idempotencyKey);
    }
  } catch (cause) {
    if (refundOperation) await retryOperation(refundOperation.id, cause);
    if (payment) {
      await recordPaymentEvent({
        paymentId: payment.id,
        orderId,
        provider: payment.provider,
        providerRef: payment.providerRef ?? undefined,
        type: "REFUND",
        status: "FAILED",
        amount: payment.amount,
        metadata: { finalStatus, message: errorMessage(cause) },
      });
    }
    throw new OrderError("Возврат передан на повторную обработку", { cause });
  }

  const settled = await prisma.$transaction(async (tx) => {
    const completed = await tx.order.updateMany({
      where: { id: orderId, status: "REFUND_PENDING" },
      data: { status: finalStatus },
    });
    if (completed.count === 0) return false;
    if (payment) {
      await tx.payment.updateMany({
        where: { id: payment.id, status: "HELD" },
        data: { status: "REFUNDED" },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          orderId,
          provider: payment.provider,
          providerRef: payment.providerRef,
          type: "REFUND",
          status: "SUCCEEDED",
          amount: payment.amount,
          metadataJson: JSON.stringify({ finalStatus }),
        },
      });
    }
    return true;
  });
  if (settled && refundOperation) await succeedOperation(refundOperation.id);
  return settled;
}

async function retryPendingRefunds(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { status: "REFUND_PENDING" },
    include: { payment: true, bag: true },
    take: 100,
  });
  for (const order of orders) {
    const finalStatus: FinalRefundStatus =
      order.refundTargetStatus === "EXPIRED" || order.refundTargetStatus === "CANCELLED"
        ? order.refundTargetStatus
        : order.bag.pickupEnd <= new Date()
          ? "EXPIRED"
          : "CANCELLED";
    try {
      const completed = await settleRefund(order.id, order.payment?.id, finalStatus);
      if (
        completed &&
        finalStatus === "CANCELLED" &&
        order.bag.status !== "CANCELLED" &&
        order.bag.pickupStart > new Date()
      ) {
        await releaseQuantity(order.bagId, order.quantity);
      }
    } catch (error) {
      console.error("Could not retry pending refund", { orderId: order.id, error });
    }
  }
}

async function cancelUnpaidOrderAndReleaseQuantity(
  orderId: string,
  bagId: string,
  quantity: number
): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { bag: true } });
  if (!order) return;
  const finalStatus: FinalRefundStatus =
    order.bag.pickupEnd <= new Date() ? "EXPIRED" : "CANCELLED";
  const cancelled = await prisma.order.updateMany({
    where: { id: orderId, status: "PENDING_PAYMENT" },
    data: { status: finalStatus },
  });
  if (cancelled.count > 0) await releaseQuantity(bagId, quantity);
}

const MAX_PAYMENT_ATTEMPTS = 5;
const LEASE_MS = 60_000;

async function ensureOperation(paymentId: string, type: "HOLD" | "CAPTURE" | "REFUND") {
  return prisma.paymentOperation.upsert({
    where: { paymentId_type: { paymentId, type } },
    update: {},
    create: { paymentId, type, idempotencyKey: randomUUID(), nextAttemptAt: new Date(0) },
  });
}

async function succeedOperation(id: string): Promise<void> {
  await prisma.paymentOperation.update({
    where: { id },
    data: { status: "SUCCEEDED", leaseOwner: null, leaseExpiresAt: null, lastError: null },
  });
}

async function retryOperation(id: string, error: unknown): Promise<void> {
  const operation = await prisma.paymentOperation.findUniqueOrThrow({ where: { id } });
  const attempts = operation.attempts + 1;
  const exhausted = attempts >= MAX_PAYMENT_ATTEMPTS;
  const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  await prisma.paymentOperation.update({
    where: { id },
    data: {
      attempts,
      status: exhausted ? "NEEDS_REVIEW" : "RETRY",
      nextAttemptAt: new Date(Date.now() + delayMs),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: errorMessage(error),
    },
  });
  if (exhausted) console.error("PAYMENT_OPERATION_NEEDS_REVIEW", { operationId: id });
}

/** Worker entrypoint: claim через lease и reconciliation по состоянию провайдера. */
export async function reconcilePendingPayments(limit = 50, workerId: string = randomUUID()): Promise<number> {
  const now = new Date(Date.now() + 1_000);
  const candidates = await prisma.paymentOperation.findMany({
    where: {
      status: { in: ["PENDING", "RETRY", "PROCESSING"] },
      nextAttemptAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  let processed = 0;
  for (const candidate of candidates) {
    const claimed = await prisma.paymentOperation.updateMany({
      where: {
        id: candidate.id,
        status: { in: ["PENDING", "RETRY", "PROCESSING"] },
        nextAttemptAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: { status: "PROCESSING", leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    if (!claimed.count) continue;
    processed += 1;
    const operation = await prisma.paymentOperation.findUniqueOrThrow({
      where: { id: candidate.id },
      include: { payment: { include: { order: { include: { bag: true } } } } },
    });
    try {
      const payment = operation.payment;
      if (operation.type === "HOLD") {
        const hold = await paymentProvider.hold(payment.amount, payment.orderId, operation.idempotencyKey);
        await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: hold.providerRef, status: "HELD" } });
        const confirmation = await confirmHeldPayment(payment.orderId);
        if (!confirmation.confirmed) {
          await ensureOperation(payment.id, "REFUND");
        }
      } else if (!payment.providerRef) {
        throw new Error("Missing provider reference");
      } else {
        const status = await paymentProvider.getStatus(payment.providerRef);
        if (operation.type === "CAPTURE" && status === "CAPTURED") {
          await prisma.$transaction([
            prisma.payment.update({ where: { id: payment.id }, data: { status: "CAPTURED" } }),
            prisma.order.updateMany({ where: { id: payment.orderId, status: "CAPTURE_PENDING" }, data: { status: "COMPLETED", completedAt: new Date() } }),
          ]);
        } else if (operation.type === "REFUND" && status === "REFUNDED") {
          await prisma.$transaction([
            prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
            prisma.order.updateMany({ where: { id: payment.orderId, status: "REFUND_PENDING" }, data: { status: payment.order.refundTargetStatus ?? "CANCELLED" } }),
          ]);
        } else if (operation.type === "CAPTURE" && status === "HELD") {
          await paymentProvider.capture(payment.providerRef, operation.idempotencyKey);
          if ((await paymentProvider.getStatus(payment.providerRef)) !== "CAPTURED") {
            throw new Error("Capture was not confirmed by provider");
          }
          await prisma.$transaction([
            prisma.payment.update({ where: { id: payment.id }, data: { status: "CAPTURED" } }),
            prisma.order.updateMany({ where: { id: payment.orderId, status: "CAPTURE_PENDING" }, data: { status: "COMPLETED", completedAt: new Date() } }),
          ]);
        } else if (operation.type === "REFUND" && status === "HELD") {
          await paymentProvider.refund(payment.providerRef, operation.idempotencyKey);
          if ((await paymentProvider.getStatus(payment.providerRef)) !== "REFUNDED") {
            throw new Error("Refund was not confirmed by provider");
          }
          await prisma.$transaction([
            prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
            prisma.order.updateMany({ where: { id: payment.orderId, status: "REFUND_PENDING" }, data: { status: payment.order.refundTargetStatus ?? "CANCELLED" } }),
          ]);
        } else {
          throw new Error(`Unexpected provider status ${status}`);
        }
      }
      await succeedOperation(operation.id);
    } catch (error) {
      await retryOperation(operation.id, error);
    }
  }
  return processed;
}

async function recordPaymentEvent(input: {
  paymentId?: string;
  orderId: string;
  provider: string;
  providerRef?: string;
  type: "HOLD" | "CAPTURE" | "REFUND";
  status: "SUCCEEDED" | "FAILED";
  amount?: number;
  metadata?: unknown;
}): Promise<void> {
  await prisma.paymentEvent.create({
    data: {
      paymentId: input.paymentId,
      orderId: input.orderId,
      provider: input.provider,
      providerRef: input.providerRef,
      type: input.type,
      status: input.status,
      amount: input.amount,
      metadataJson: JSON.stringify(input.metadata ?? {}),
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown payment provider error";
}

/** Пара pickup-код может совпасть с существующим — ретраим создание строки. */
async function createOrderRowWithUniqueCode(
  tx: Prisma.TransactionClient,
  data: {
    bagId: string;
    userId: string;
    quantity: number;
    totalPrice: number;
    platformFee: number;
  }
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.order.create({
        data: { ...data, pickupCode: generatePickupCode(), status: "PENDING_PAYMENT" },
      });
    } catch (error) {
      const isCodeCollision =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isCodeCollision || attempt >= 3) throw error;
    }
  }
}

async function releaseQuantity(bagId: string, quantity: number) {
  await prisma.$transaction(async (tx) => {
    await tx.bag.update({
      where: { id: bagId },
      data: { quantityLeft: { increment: quantity } },
    });
    const bag = await tx.bag.findUniqueOrThrow({ where: { id: bagId } });
    if (bag.status === "SOLD_OUT" && bag.quantityLeft > 0 && bag.pickupEnd > new Date()) {
      await tx.bag.update({ where: { id: bagId }, data: { status: "ACTIVE" } });
    }
  });
}
