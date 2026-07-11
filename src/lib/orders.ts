import { Prisma } from "@prisma/client";
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
    return createOrderRowWithUniqueCode(tx, {
      bagId,
      userId,
      quantity,
      totalPrice,
      platformFee: Math.round(totalPrice * PLATFORM_FEE_PCT),
    });
  });

  let providerRef: string;
  try {
    ({ providerRef } = await paymentProvider.hold(order.totalPrice, order.id));
  } catch (cause) {
    await cancelUnpaidOrderAndReleaseQuantity(order.id, order.bagId, order.quantity);
    throw new OrderError("Оплата не прошла, попробуйте ещё раз", { cause });
  }

  let payment: { id: string; provider: string; providerRef: string; amount: number };
  try {
    payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: paymentProvider.name,
        providerRef,
        amount: order.totalPrice,
        status: "HELD",
      },
    });
    await recordPaymentEvent({
      paymentId: payment.id,
      orderId: order.id,
      provider: payment.provider,
      providerRef: payment.providerRef,
      type: "HOLD",
      status: "SUCCEEDED",
      amount: payment.amount,
    });
  } catch (cause) {
    // Если БД не зафиксировала reference, единственный безопасный вариант —
    // сразу попытаться снять hold и вернуть резерв остатка.
    try {
      await paymentProvider.refund(providerRef);
    } catch (refundError) {
      console.error("Could not release unpersisted payment hold", { orderId: order.id, refundError });
    }
    await cancelUnpaidOrderAndReleaseQuantity(order.id, order.bagId, order.quantity);
    throw new OrderError("Не удалось подтвердить оплату, попробуйте ещё раз", { cause });
  }

  const confirmation = await confirmHeldPayment(order.id);
  if (!confirmation.confirmed) {
    try {
      await settleRefund(order.id, payment.id, confirmation.finalStatus);
    } catch (refundError) {
      console.error("Could not refund payment for unavailable bag", {
        orderId: order.id,
        refundError,
      });
    }
    throw new OrderError("Пакет стал недоступен. Возврат по оплате уже запущен");
  }

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

  await releaseQuantity(order.bagId, order.quantity);
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

  // Не выдаём товар до успешного capture: при сбое статус остаётся
  // CAPTURE_PENDING и его можно сверить с платёжным провайдером.
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: "PAID" },
    data: { status: "CAPTURE_PENDING" },
  });
  if (claimed.count === 0) throw new OrderError("Заказ уже обрабатывается");

  try {
    await paymentProvider.capture(payment.providerRef);
  } catch (cause) {
    await recordPaymentEvent({
      paymentId: payment.id,
      orderId: order.id,
      provider: payment.provider,
      providerRef: payment.providerRef,
      type: "CAPTURE",
      status: "FAILED",
      amount: payment.amount,
      metadata: { message: errorMessage(cause) },
    });
    throw new OrderError("Списание не подтверждено. Заказ передан на сверку", { cause });
  }

  const completed = await prisma.$transaction(async (tx) => {
    const transitioned = await tx.order.updateMany({
      where: { id: order.id, status: "CAPTURE_PENDING" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (transitioned.count === 0) throw new OrderError("Заказ уже обрабатывается");
    await tx.payment.updateMany({
      where: { id: payment.id, status: "HELD" },
      data: { status: "CAPTURED" },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        provider: payment.provider,
        providerRef: payment.providerRef,
        type: "CAPTURE",
        status: "SUCCEEDED",
        amount: payment.amount,
      },
    });
    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { bag: { include: { venue: true } }, payment: true, user: true },
    });
  });

  if (completed.user.telegramId) {
    await sendTelegramMessage(
      completed.user.telegramId,
      `✅ Заказ в «${completed.bag.venue.name}» выдан. Приятного аппетита!`
    );
  }
  return completed;
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

  await settleRefund(orderId, paymentId, finalStatus);
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
  try {
    if (payment?.status === "HELD") {
      await paymentProvider.refund(payment.providerRef);
    }
  } catch (cause) {
    if (payment) {
      await recordPaymentEvent({
        paymentId: payment.id,
        orderId,
        provider: payment.provider,
        providerRef: payment.providerRef,
        type: "REFUND",
        status: "FAILED",
        amount: payment.amount,
        metadata: { finalStatus, message: errorMessage(cause) },
      });
    }
    throw new OrderError("Возврат передан на повторную обработку", { cause });
  }

  return prisma.$transaction(async (tx) => {
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
