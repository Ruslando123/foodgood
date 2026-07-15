import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "./db";
import { assertPaymentProviderReady, paymentProvider, PaymentProviderError } from "./payments";
import { generatePickupCode } from "./qr";
import { PLATFORM_FEE_PCT } from "./config";
import { telegramNotificationsEnabled } from "./telegram";
import { paymentFailures, workerClaims, workerFailures, workerJobDuration, workerLeaseLost, workerSuccesses } from "./metrics";
import { startLeaseHeartbeat } from "./lease-heartbeat";
import { PAYMENT_PROVIDER_TIMEOUT_MS } from "./payment-config";
import { getPaymentMode } from "./payment-mode";
import { transitionBagOrders, transitionOrder } from "@/modules/orders/state-machine";
import type { FreedomPayFields } from "./freedompay";

export class OrderError extends Error {}
class OperationLeaseLostError extends Error {}

type FinalRefundStatus = "CANCELLED" | "EXPIRED";
type OperationType = "HOLD" | "CAPTURE" | "REFUND";

export type FreedomPayResultDecision = { status: "ok" | "rejected" | "error"; description: string };

export const ACTIVE_PICKUP_ORDER_STATUSES = ["RESERVED", "PENDING_PAYMENT", "PAID", "READY_FOR_PICKUP", "CAPTURE_PENDING"];

export function customerOrderScopeWhere(userId: string, scope: "active" | "history", now = new Date()): Prisma.OrderWhereInput {
  const activeStatus = { in: ACTIVE_PICKUP_ORDER_STATUSES };
  return scope === "active"
    ? { userId, status: activeStatus, bag: { pickupEnd: { gt: now } } }
    : { userId, OR: [{ status: { notIn: ACTIVE_PICKUP_ORDER_STATUSES } }, { bag: { pickupEnd: { lte: now } } }] };
}

const MAX_PAYMENT_ATTEMPTS = 5;
const LEASE_MS = 60_000;
// Must stay comfortably below LEASE_MS so a worker never holds a lease forever
// while a provider connection is stalled.
const WORKER_CONCURRENCY = 5;

const orderInclude = { bag: { include: { venue: true } }, payment: true } as const;

/** Claims and expires at most `limit` rows of each kind; safe to run concurrently. */
export async function expireStale(limit = 250): Promise<number> {
  const expiredBags = await prisma.$executeRaw`
    WITH candidates AS (
      SELECT id FROM "Bag"
      WHERE status IN ('ACTIVE', 'SOLD_OUT') AND "pickupEnd" < now()
      ORDER BY "pickupEnd", id FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "Bag" bag SET status = 'EXPIRED'
    FROM candidates WHERE bag.id = candidates.id
  `;
  const expiredPending = await prisma.$executeRaw`
    WITH candidates AS (
      SELECT orders.id FROM "Order" orders
      JOIN "Bag" bag ON bag.id = orders."bagId"
      WHERE orders.status = 'PENDING_PAYMENT' AND bag."pickupEnd" < now()
      ORDER BY bag."pickupEnd", orders.id FOR UPDATE OF orders SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "Order" orders SET status = 'EXPIRED'
    FROM candidates WHERE orders.id = candidates.id
  `;
  const expiredPayAtPickup = await prisma.$executeRaw`
    WITH candidates AS (
      SELECT orders.id FROM "Order" orders
      JOIN "Bag" bag ON bag.id = orders."bagId"
      WHERE orders."paymentMethod" = 'PAY_AT_PICKUP'
        AND orders.status IN ('RESERVED', 'READY_FOR_PICKUP')
        AND bag."pickupEnd" < now()
      ORDER BY bag."pickupEnd", orders.id FOR UPDATE OF orders SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "Order" orders SET status = 'EXPIRED'
    FROM candidates WHERE orders.id = candidates.id
  `;
  const refundRows = await prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<Array<{ id: string; paymentId: string }>>`
      WITH candidates AS (
        SELECT orders.id FROM "Order" orders
        JOIN "Bag" bag ON bag.id = orders."bagId"
        WHERE orders.status IN ('PAID', 'READY_FOR_PICKUP') AND bag."pickupEnd" < now()
        ORDER BY bag."pickupEnd", orders.id FOR UPDATE OF orders SKIP LOCKED LIMIT ${limit}
      )
      UPDATE "Order" orders
      SET status = 'REFUND_PENDING', "refundTargetStatus" = 'EXPIRED'
      FROM candidates, "Payment" payment
      WHERE orders.id = candidates.id AND payment."orderId" = orders.id
      RETURNING orders.id, payment.id AS "paymentId"
    `;
    if (claimed.length) {
      await tx.paymentOperation.createMany({
        data: claimed.map(({ paymentId }) => ({ paymentId, type: "REFUND", idempotencyKey: randomUUID(), nextAttemptAt: new Date(0) })),
        skipDuplicates: true,
      });
    }
    return claimed.length;
  });
  return Number(expiredBags) + Number(expiredPending) + Number(expiredPayAtPickup) + refundRows;
}

/** HTTP only reserves inventory and atomically queues HOLD. */
export async function createOrder(
  userId: string,
  bagId: string,
  quantity: number,
  idempotencyRecordId?: string,
  idempotencyOwnerToken?: string
) {
  const paymentMode = getPaymentMode();
  if (paymentMode === "ONLINE") assertPaymentProviderReady();
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new OrderError("Некорректное количество");
  }

  const order = await prisma.$transaction(async (tx) => {
    if (idempotencyRecordId) {
      if (!idempotencyOwnerToken) throw new OrderError("Отсутствует owner token идемпотентного запроса");
      const ownership = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "OrderIdempotencyKey"
        SET "expiresAt" = now() + interval '60 seconds'
        WHERE id = ${idempotencyRecordId}
          AND "ownerToken" = ${idempotencyOwnerToken}
          AND status = 'PROCESSING'
        RETURNING id
      `;
      if (!ownership.length) throw new OrderError("Владение идемпотентным запросом потеряно");
      const existing = await tx.order.findUnique({
        where: { idempotencyRecordId },
        include: orderInclude,
      });
      if (existing) return existing;
    }
    // Package edits take the same row lock. This makes the price/window read
    // and the inventory reservation one serializable domain operation.
    await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${bagId} FOR UPDATE`;
    const bag = await tx.bag.findUnique({ where: { id: bagId } });
    if (!bag || bag.status !== "ACTIVE") throw new OrderError("Пакет недоступен");
    if (bag.pickupEnd <= new Date()) throw new OrderError("Окно выдачи уже закончилось");

    const reserved = await tx.bag.updateMany({
      where: { id: bagId, status: "ACTIVE", quantityLeft: { gte: quantity } },
      data: { quantityLeft: { decrement: quantity } },
    });
    if (!reserved.count) throw new OrderError("Столько пакетов уже не осталось");

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
      platformFee: paymentMode === "ONLINE" ? Math.round(totalPrice * PLATFORM_FEE_PCT) : 0,
      paymentMethod: paymentMode,
      status: paymentMode === "ONLINE" ? "PENDING_PAYMENT" : "RESERVED",
      idempotencyRecordId,
    });
    if (paymentMode === "ONLINE") {
      const payment = await tx.payment.create({
        data: { orderId: created.id, provider: paymentProvider.name, amount: totalPrice },
      });
      await ensureOperation(tx, payment.id, "HOLD");
    } else {
      await ensurePickupReminder(tx, created.id, bag.pickupStart);
    }
    const result = await tx.order.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
    return result;
  });

  return order;
}

/** HTTP queues refund and returns REFUND_PENDING; reconciliation performs it. */
export async function cancelOrder(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { bag: true },
  });
  if (!order || order.userId !== userId) throw new OrderError("Заказ не найден");
  const payAtPickup = order.paymentMethod === "PAY_AT_PICKUP";
  const cancellable = payAtPickup ? ["RESERVED", "READY_FOR_PICKUP"] : ["PAID", "READY_FOR_PICKUP"];
  if (!cancellable.includes(order.status)) throw new OrderError("Заказ нельзя отменить");
  if (order.bag.pickupStart <= new Date()) {
    throw new OrderError("Окно выдачи уже началось — отмена недоступна");
  }
  if (payAtPickup) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: orderId }, include: { bag: true } });
      if (!current || current.userId !== userId || current.paymentMethod !== "PAY_AT_PICKUP") {
        throw new OrderError("Заказ не найден");
      }
      const cancelled = await transitionOrder(tx, {
        id: orderId,
        from: ["RESERVED", "READY_FOR_PICKUP"],
        to: "CANCELLED",
      });
      if (!cancelled) throw new OrderError("Заказ уже обрабатывается");
      await restoreReservedInventory(tx, current.bagId, current.quantity);
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    });
  }
  if (!(await queueRefund(orderId, "CANCELLED"))) {
    throw new OrderError("Заказ уже обрабатывается");
  }
  return prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
}

/** HTTP atomically claims PAID -> CAPTURE_PENDING and queues CAPTURE. */
export async function redeemOrder(merchantId: string, pickupCode: string, paymentConfirmed = false) {
  const code = pickupCode.trim().toUpperCase();
  const order = await prisma.order.findUnique({
    where: { pickupCode: code },
    include: { payment: true, bag: { include: { venue: true } }, user: true },
  });
  if (!order) throw new OrderError("Код не найден");
  if (order.bag.venue.ownerId !== merchantId) throw new OrderError("Код от другого заведения");
  if (order.bag.pickupEnd <= new Date()) throw new OrderError("Окно выдачи закончилось");
  if (order.status === "COMPLETED") throw new OrderError("Заказ уже выдан");
  if (order.status === "CAPTURE_PENDING") {
    throw new OrderError("Списание уже обрабатывается, проверьте статус позже");
  }
  if (order.paymentMethod === "PAY_AT_PICKUP") {
    if (!paymentConfirmed) throw new OrderError("Подтвердите получение оплаты в заведении");
    if (!["RESERVED", "READY_FOR_PICKUP"].includes(order.status)) {
      throw new OrderError("Бронь отменена или недоступна для выдачи");
    }
    const completed = await prisma.$transaction(async (tx) => transitionOrder(tx, {
      id: order.id,
      from: ["RESERVED", "READY_FOR_PICKUP"],
      to: "COMPLETED",
      data: { completedAt: new Date() },
    }));
    if (!completed) throw new OrderError("Заказ уже обрабатывается");
    return prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { ...orderInclude, user: true },
    });
  }
  if (!["PAID", "READY_FOR_PICKUP"].includes(order.status)) throw new OrderError("Заказ не оплачен или отменён");
  if (!order.payment?.providerRef) throw new OrderError("Для заказа не найден reference платежа");

  const claimed = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { orderId: order.id } });
    if (!payment?.providerRef) throw new OrderError("Для заказа не найден reference платежа");
    const transitioned = await transitionOrder(tx, {
      id: order.id,
      from: ["PAID", "READY_FOR_PICKUP"],
      to: "CAPTURE_PENDING",
    });
    if (!transitioned) return false;
    await ensureOperation(tx, payment.id, "CAPTURE");
    return true;
  });
  if (!claimed) throw new OrderError("Заказ уже обрабатывается");
  return prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { ...orderInclude, user: true },
  });
}

export async function markOrderReady(merchantId: string, orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, bag: { venue: { ownerId: merchantId } } },
      include: { user: true, payment: true, bag: { include: { venue: true } } },
    });
    if (!order) throw new OrderError("Заказ не найден");

    const transitioned = await transitionOrder(tx, {
      id: orderId,
      from: ["RESERVED", "PAID"],
      to: "READY_FOR_PICKUP",
    });
    if (!transitioned) throw new OrderError("Заказ нельзя отметить готовым");

    await tx.notification.upsert({
      where: { dedupeKey: `order-ready:${orderId}` },
      update: {},
      create: {
        userId: order.userId,
        channel: "IN_APP",
        recipient: order.userId,
        type: "ORDER_READY",
        status: "SENT",
        sentAt: new Date(),
        dedupeKey: `order-ready:${orderId}`,
        payloadJson: JSON.stringify({
          orderId,
          venueName: order.bag.venue.name,
          title: order.bag.title,
        }),
      },
    });

    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { user: true, payment: true, bag: { include: { venue: true } } },
    });
  });
}

/** Cancelling a bag is local/transactional; each paid order gets a refund job. */
export async function cancelBagWithRefunds(merchantId: string, bagId: string) {
  await prisma.$transaction(async (tx) => {
    const bag = await tx.bag.findUnique({ where: { id: bagId }, include: { venue: true } });
    if (!bag || bag.venue.ownerId !== merchantId) throw new OrderError("Пакет не найден");
    await tx.bag.update({ where: { id: bagId }, data: { status: "CANCELLED" } });
    await transitionBagOrders(tx, bagId, "PENDING_PAYMENT", "CANCELLED");
    await transitionBagOrders(
      tx,
      bagId,
      ["RESERVED", "READY_FOR_PICKUP"],
      "CANCELLED",
      { paymentMethod: "PAY_AT_PICKUP" }
    );

    await tx.batchJob.upsert({
      where: { dedupeKey: `refund-cancelled-bag:${bag.id}` },
      update: {},
      create: {
        queue: "refunds",
        type: "REFUND_CANCELLED_BAG",
        dedupeKey: `refund-cancelled-bag:${bag.id}`,
        payloadJson: JSON.stringify({ bagId: bag.id }),
        nextAttemptAt: new Date(0),
      },
    });
  });
  return prisma.bag.findUniqueOrThrow({ where: { id: bagId }, include: { venue: true } });
}

export async function queueRefund(orderId: string, finalStatus: FinalRefundStatus): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (!order?.payment) return false;
    const claimed = await transitionOrder(tx, {
      id: orderId,
      from: ["PAID", "READY_FOR_PICKUP"],
      to: "REFUND_PENDING",
      data: { refundTargetStatus: finalStatus },
    });
    if (!claimed) return false;
    await ensureOperation(tx, order.payment.id, "REFUND");
    return true;
  });
}

async function ensureOperation(tx: Prisma.TransactionClient, paymentId: string, type: OperationType) {
  return tx.paymentOperation.upsert({
    where: { paymentId_type: { paymentId, type } },
    update: {},
    create: { paymentId, type, idempotencyKey: randomUUID(), nextAttemptAt: new Date(0) },
  });
}

async function ensurePickupReminder(tx: Prisma.TransactionClient, orderId: string, pickupStart: Date) {
  await tx.batchJob.upsert({
    where: { dedupeKey: `pickup-reminder:${orderId}` },
    update: {},
    create: {
      queue: "notifications",
      type: "PICKUP_REMINDER",
      dedupeKey: `pickup-reminder:${orderId}`,
      payloadJson: JSON.stringify({ orderId }),
      nextAttemptAt: new Date(pickupStart.getTime() - 60 * 60_000),
    },
  });
}

async function restoreReservedInventory(tx: Prisma.TransactionClient, bagId: string, quantity: number) {
  const restored = await tx.bag.updateMany({
    where: { id: bagId, status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupStart: { gt: new Date() } },
    data: { quantityLeft: { increment: quantity } },
  });
  if (restored.count) {
    await tx.bag.updateMany({
      where: { id: bagId, status: "SOLD_OUT", quantityLeft: { gt: 0 } },
      data: { status: "ACTIVE" },
    });
  }
}

/** Applies a verified Freedom Pay result callback and fences any in-flight worker. */
export async function applyFreedomPayResult(fields: FreedomPayFields): Promise<FreedomPayResultDecision> {
  const idempotencyKey = fields.pg_order_id;
  const providerRef = fields.pg_payment_id;
  const amount = Number(fields.pg_amount);
  const result = fields.pg_result;
  if (!idempotencyKey || !providerRef || !Number.isFinite(amount) || amount <= 0) {
    return { status: "error", description: "Missing payment fields" };
  }
  if (fields.pg_currency !== "KZT") return { status: "rejected", description: "Unsupported currency" };
  if (!["0", "1", "2"].includes(result)) return { status: "error", description: "Invalid payment result" };
  if (result === "1" && !["0", "1"].includes(fields.pg_captured)) {
    return { status: "error", description: "Invalid capture status" };
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "PaymentOperation"
      WHERE "idempotencyKey" = ${idempotencyKey} AND type = 'HOLD'
      FOR UPDATE
    `;
    if (!locked.length) return { status: "rejected" as const, description: "Unknown order" };
    const operation = await tx.paymentOperation.findUniqueOrThrow({
      where: { id: locked[0].id },
      include: { payment: { include: { order: { include: { bag: true } } } } },
    });
    const payment = operation.payment;
    const order = payment.order;
    if (payment.provider !== "freedompay") return { status: "rejected" as const, description: "Wrong provider" };
    if (payment.amount !== amount) return { status: "rejected" as const, description: "Amount mismatch" };
    if (payment.providerRef && payment.providerRef !== providerRef) {
      return { status: "rejected" as const, description: "Payment reference mismatch" };
    }
    if (operation.status === "SUCCEEDED") return { status: "ok" as const, description: "Already processed" };

    if (result === "2") {
      await tx.payment.update({ where: { id: payment.id }, data: { providerRef } });
      await parkOperationFromCallback(tx, operation.id);
      return { status: "ok" as const, description: "Payment is pending" };
    }

    if (result === "0") {
      await failHoldFromCallback(tx, operation.id, payment.id, order.id, order.bagId, order.quantity, providerRef);
      return { status: "ok" as const, description: "Payment failure recorded" };
    }

    const providerStatus = fields.pg_captured === "1" ? "CAPTURED" : "HELD";
    const orderCanBePaid =
      order.status === "PENDING_PAYMENT" &&
      ["ACTIVE", "SOLD_OUT"].includes(order.bag.status) &&
      order.bag.pickupEnd > new Date();
    if (!orderCanBePaid && !["PAID", "READY_FOR_PICKUP", "CAPTURE_PENDING", "COMPLETED"].includes(order.status)) {
      if (fields.pg_can_reject === "1") {
        await failHoldFromCallback(tx, operation.id, payment.id, order.id, order.bagId, order.quantity, providerRef);
        return { status: "rejected" as const, description: "Order is no longer payable" };
      }
      await tx.payment.update({ where: { id: payment.id }, data: { providerRef, status: providerStatus } });
      const finalStatus: FinalRefundStatus = order.bag.pickupEnd <= new Date() ? "EXPIRED" : "CANCELLED";
      await transitionOrder(tx, {
        id: order.id,
        from: ["PENDING_PAYMENT", "CANCELLED", "EXPIRED"],
        to: "REFUND_PENDING",
        data: { refundTargetStatus: finalStatus },
      });
      await ensureOperation(tx, payment.id, "REFUND");
      await completeHoldFromCallback(tx, operation.id, payment.id, order.id, providerRef, providerStatus);
      return { status: "ok" as const, description: "Payment accepted and refund queued" };
    }

    await tx.payment.update({ where: { id: payment.id }, data: { providerRef, status: providerStatus } });
    if (orderCanBePaid) {
      await transitionOrder(tx, { id: order.id, from: "PENDING_PAYMENT", to: "PAID" });
      await tx.batchJob.upsert({
        where: { dedupeKey: `pickup-reminder:${order.id}` },
        update: {},
        create: {
          queue: "notifications",
          type: "PICKUP_REMINDER",
          dedupeKey: `pickup-reminder:${order.id}`,
          payloadJson: JSON.stringify({ orderId: order.id }),
          nextAttemptAt: new Date(order.bag.pickupStart.getTime() - 60 * 60_000),
        },
      });
    }
    await completeHoldFromCallback(tx, operation.id, payment.id, order.id, providerRef, providerStatus);
    return { status: "ok" as const, description: "Payment recorded" };
  });
}

async function parkOperationFromCallback(tx: Prisma.TransactionClient, operationId: string) {
  await tx.paymentOperation.update({
    where: { id: operationId },
    data: {
      status: "WAITING_PROVIDER",
      nextAttemptAt: new Date(Date.now() + 2 * 60_000),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
}

async function completeHoldFromCallback(
  tx: Prisma.TransactionClient,
  operationId: string,
  paymentId: string,
  orderId: string,
  providerRef: string,
  providerStatus: "HELD" | "CAPTURED"
) {
  await tx.paymentEvent.upsert({
    where: { operationId },
    update: {
      paymentId,
      orderId,
      provider: "freedompay",
      providerRef,
      type: "HOLD",
      status: "SUCCEEDED",
      metadataJson: JSON.stringify({ source: "webhook", providerStatus }),
    },
    create: {
      operationId,
      paymentId,
      orderId,
      provider: "freedompay",
      providerRef,
      type: "HOLD",
      status: "SUCCEEDED",
      metadataJson: JSON.stringify({ source: "webhook", providerStatus }),
    },
  });
  await tx.paymentOperation.update({
    where: { id: operationId },
    data: { status: "SUCCEEDED", leaseOwner: null, leaseExpiresAt: null, lastError: null },
  });
}

async function failHoldFromCallback(
  tx: Prisma.TransactionClient,
  operationId: string,
  paymentId: string,
  orderId: string,
  bagId: string,
  quantity: number,
  providerRef: string
) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { bag: true } });
  if (order?.status === "PENDING_PAYMENT") {
    const finalStatus: FinalRefundStatus = order.bag.pickupEnd <= new Date() ? "EXPIRED" : "CANCELLED";
    const cancelled = await transitionOrder(tx, { id: orderId, from: "PENDING_PAYMENT", to: finalStatus });
    if (cancelled) {
      const restored = await tx.bag.updateMany({
        where: { id: bagId, status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupEnd: { gt: new Date() } },
        data: { quantityLeft: { increment: quantity } },
      });
      if (restored.count) {
        await tx.bag.updateMany({
          where: { id: bagId, status: "SOLD_OUT", quantityLeft: { gt: 0 } },
          data: { status: "ACTIVE" },
        });
      }
    }
  }
  await tx.payment.update({ where: { id: paymentId }, data: { providerRef, status: "FAILED" } });
  await tx.paymentEvent.upsert({
    where: { operationId },
    update: { paymentId, orderId, provider: "freedompay", providerRef, type: "HOLD", status: "FAILED", metadataJson: JSON.stringify({ source: "webhook" }) },
    create: { operationId, paymentId, orderId, provider: "freedompay", providerRef, type: "HOLD", status: "FAILED", metadataJson: JSON.stringify({ source: "webhook" }) },
  });
  await tx.paymentOperation.update({
    where: { id: operationId },
    data: { status: "SUCCEEDED", leaseOwner: null, leaseExpiresAt: null, lastError: null },
  });
}

/** Claim is atomic, while network work happens after the transaction closes. */
export async function reconcilePendingPayments(limit = 50, processWorkerId: string = randomUUID()): Promise<number> {
  if (getPaymentMode() === "PAY_AT_PICKUP") return 0;
  assertPaymentProviderReady();
  let claimed = 0;
  let processed = 0;
  const concurrency = Math.min(WORKER_CONCURRENCY, limit);
  const workers = Array.from({ length: concurrency }, async () => {
    while (claimed < limit) {
      claimed += 1;
      const leaseToken = `${processWorkerId}:${randomUUID()}`;
      const candidate = await claimPaymentOperation(leaseToken);
      if (!candidate) return;
      workerClaims.inc({ worker: "payments" });
      if (await processPaymentOperation(candidate.id, leaseToken)) processed += 1;
    }
  });
  await Promise.all(workers);
  return processed;
}

/** Daily provider-vs-ledger audit. Mismatches are recorded for operator review, never auto-corrected. */
export async function reconcileSettledPayments(limit = 50): Promise<{ checked: number; mismatches: number }> {
  if (getPaymentMode() === "PAY_AT_PICKUP") return { checked: 0, mismatches: 0 };
  assertPaymentProviderReady();
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const payments = await prisma.payment.findMany({
    where: {
      provider: paymentProvider.name,
      status: { in: ["HELD", "CAPTURED", "REFUNDED"] },
      order: { status: { in: ["PAID", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "EXPIRED"] } },
      events: { none: { type: "RECONCILIATION", createdAt: { gte: since } } },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  let mismatches = 0;
  for (const payment of payments) {
    let actual = "UNKNOWN";
    let error: string | undefined;
    try {
      if (!payment.providerRef) throw new Error("Missing provider reference");
      actual = await providerCall("daily reconciliation", paymentProvider.getStatus(payment.providerRef));
    } catch (cause) {
      error = errorMessage(cause);
    }
    const matches = !error && actual === payment.status;
    if (!matches) {
      mismatches += 1;
      console.error("PAYMENT_RECONCILIATION_MISMATCH", {
        paymentId: payment.id,
        expected: payment.status,
        actual,
        error,
      });
    }
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        providerRef: payment.providerRef,
        type: "RECONCILIATION",
        status: matches ? "SUCCEEDED" : "FAILED",
        amount: payment.amount,
        metadataJson: JSON.stringify({ expected: payment.status, actual, ...(error ? { error } : {}) }),
      },
    });
  }
  return { checked: payments.length, mismatches };
}

async function claimPaymentOperation(leaseToken: string): Promise<{ id: string } | null> {
  const [candidate] = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidates AS (
      SELECT id FROM "PaymentOperation"
      WHERE status IN ('PENDING', 'RETRY', 'PROCESSING', 'WAITING_PROVIDER')
        AND "nextAttemptAt" <= now()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "nextAttemptAt", id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "PaymentOperation" operation
    SET status = 'PROCESSING', "leaseOwner" = ${leaseToken},
        "leaseExpiresAt" = now() + interval '60 seconds'
    FROM candidates WHERE operation.id = candidates.id
    RETURNING operation.id
  `;
  return candidate ?? null;
}

async function processPaymentOperation(operationId: string, leaseToken: string): Promise<boolean> {
  const startedAt = performance.now();
  let metricResult = "success";
  const operation = await prisma.paymentOperation.findUniqueOrThrow({
    where: { id: operationId },
    include: { payment: { include: { order: { include: { bag: { include: { venue: true } }, user: true } } } } },
  });
  const heartbeat = startLeaseHeartbeat(
    async () => (await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "PaymentOperation"
      SET "leaseExpiresAt" = now() + interval '60 seconds'
      WHERE id = ${operationId} AND status = 'PROCESSING'
        AND "leaseOwner" = ${leaseToken} AND "leaseExpiresAt" > now()
      RETURNING id
    `).length === 1,
    LEASE_MS / 3
  );
  try {
    const payment = operation.payment;
    if (operation.type === "HOLD") {
      const known = await providerCall("find hold", paymentProvider.findHoldByIdempotencyKey(operation.idempotencyKey));
      const hold = known ?? await providerCall(
        "hold",
        paymentProvider.hold(payment.amount, payment.orderId, operation.idempotencyKey)
      );
      if (!hold) throw new Error("Hold was not created");
      if (hold.status === "PENDING") {
        if (heartbeat.lost()) throw new OperationLeaseLostError(`Payment operation lease lost: ${operation.id}`);
        await waitForProvider(operation.id, leaseToken, payment.id, hold.providerRef);
      } else if (hold.status === "FAILED") {
        throw new PaymentProviderError("DECLINED", "Freedom Pay payment failed");
      } else if (hold.status === "HELD" || hold.status === "CAPTURED") {
        if (heartbeat.lost()) throw new OperationLeaseLostError(`Payment operation lease lost: ${operation.id}`);
        await finalizeHold(operation.id, leaseToken, payment.id, payment.orderId, hold.providerRef, hold.status);
      } else {
        throw new Error(`Unexpected hold status ${hold.status}`);
      }
    } else {
      if (!payment.providerRef) throw new Error("Missing provider reference");
      let providerStatus = await providerCall("get status", paymentProvider.getStatus(payment.providerRef));
      if (operation.type === "CAPTURE" && providerStatus === "HELD") {
        await providerCall("capture", paymentProvider.capture(payment.providerRef, operation.idempotencyKey));
        providerStatus = await providerCall("confirm capture", paymentProvider.getStatus(payment.providerRef));
      }
      if (operation.type === "REFUND" && (providerStatus === "HELD" || providerStatus === "CAPTURED")) {
        await providerCall("refund", paymentProvider.refund(payment.providerRef, operation.idempotencyKey));
        providerStatus = await providerCall("confirm refund", paymentProvider.getStatus(payment.providerRef));
      }
      if (operation.type === "CAPTURE" && providerStatus === "CAPTURED") {
        if (heartbeat.lost()) throw new OperationLeaseLostError(`Payment operation lease lost: ${operation.id}`);
        await finalizeCapture(operation.id, leaseToken, payment.id, payment.orderId, payment.provider, payment.providerRef, payment.amount);
      } else if (operation.type === "REFUND" && providerStatus === "REFUNDED") {
        if (heartbeat.lost()) throw new OperationLeaseLostError(`Payment operation lease lost: ${operation.id}`);
        await finalizeRefund(operation.id, leaseToken, payment.id, payment.orderId, payment.provider, payment.providerRef, payment.amount);
      } else if (providerStatus === "PENDING") {
        if (heartbeat.lost()) throw new OperationLeaseLostError(`Payment operation lease lost: ${operation.id}`);
        await waitForProvider(operation.id, leaseToken, payment.id, payment.providerRef);
      } else {
        throw new Error(`Unexpected provider status ${providerStatus}`);
      }
    }
  } catch (error) {
    if (error instanceof OperationLeaseLostError) {
      metricResult = "lease_lost";
      workerLeaseLost.inc({ worker: "payments" });
      return false;
    }
    metricResult = "failure";
    workerFailures.inc({ worker: "payments" });
    paymentFailures.inc({ operation: operation.type });
    if (operation.type === "HOLD" && error instanceof PaymentProviderError && error.code === "DECLINED") {
      await declineHold(operation.id, leaseToken, operation.payment.id, operation.payment.orderId, operation.payment.order.bagId, operation.payment.order.quantity);
    } else {
      await retryOperation(operation.id, leaseToken, operation.attempts, error);
    }
  } finally {
    await heartbeat.stop();
    workerJobDuration.observe({ worker: "payments", result: metricResult }, (performance.now() - startedAt) / 1000);
  }
  if (metricResult === "success") workerSuccesses.inc({ worker: "payments" });
  return true;
}

async function waitForProvider(operationId: string, leaseToken: string, paymentId: string, providerRef: string) {
  await prisma.$transaction(async (tx) => {
    await renewOperationLease(tx, operationId, leaseToken);
    await tx.payment.update({ where: { id: paymentId }, data: { providerRef } });
    const waiting = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "PaymentOperation"
      SET status = 'WAITING_PROVIDER', "nextAttemptAt" = now() + interval '2 minutes',
          "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
      WHERE id = ${operationId} AND status = 'PROCESSING' AND "leaseOwner" = ${leaseToken}
        AND "leaseExpiresAt" > now()
      RETURNING id
    `;
    if (!waiting.length) throw new OperationLeaseLostError(`Payment operation lease lost: ${operationId}`);
  });
}

async function finalizeHold(
  operationId: string,
  leaseToken: string,
  paymentId: string,
  orderId: string,
  providerRef: string,
  providerStatus: "HELD" | "CAPTURED" = "HELD"
) {
  await prisma.$transaction(async (tx) => {
    await renewOperationLease(tx, operationId, leaseToken);
    await tx.payment.update({ where: { id: paymentId }, data: { providerRef, status: providerStatus } });
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { bag: true } });
    if (!order) throw new OrderError("Заказ не найден");
    if (order.status === "PENDING_PAYMENT" && ["ACTIVE", "SOLD_OUT"].includes(order.bag.status) && order.bag.pickupEnd > new Date()) {
      const paid = await transitionOrder(tx, { id: orderId, from: "PENDING_PAYMENT", to: "PAID" });
      if (!paid) throw new OrderError("Статус заказа уже изменился");
      await tx.batchJob.upsert({
        where: { dedupeKey: `pickup-reminder:${orderId}` },
        update: {},
        create: {
          queue: "notifications",
          type: "PICKUP_REMINDER",
          dedupeKey: `pickup-reminder:${orderId}`,
          payloadJson: JSON.stringify({ orderId }),
          nextAttemptAt: new Date(order.bag.pickupStart.getTime() - 60 * 60_000),
        },
      });
    } else if (order.status !== "REFUND_PENDING") {
      const finalStatus: FinalRefundStatus = order.bag.pickupEnd <= new Date() ? "EXPIRED" : "CANCELLED";
      const queued = await transitionOrder(tx, {
        id: orderId,
        from: ["PENDING_PAYMENT", "CANCELLED", "EXPIRED"],
        to: "REFUND_PENDING",
        data: { refundTargetStatus: finalStatus },
      });
      if (queued) await ensureOperation(tx, paymentId, "REFUND");
    }
    await recordPaymentEvent(tx, { operationId, paymentId, orderId, provider: paymentProvider.name, providerRef, type: "HOLD", status: "SUCCEEDED" });
    await succeedOperation(tx, operationId, leaseToken);
  });
}

async function finalizeCapture(operationId: string, leaseToken: string, paymentId: string, orderId: string, provider: string, providerRef: string, amount: number) {
  await prisma.$transaction(async (tx) => {
    await renewOperationLease(tx, operationId, leaseToken);
    await tx.payment.update({ where: { id: paymentId }, data: { status: "CAPTURED" } });
    await transitionOrder(tx, {
      id: orderId,
      from: "CAPTURE_PENDING",
      to: "COMPLETED",
      data: { completedAt: new Date() },
    });
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { user: true, bag: { include: { venue: true } } } });
    if (order?.status === "COMPLETED" && order.user.telegramId && telegramNotificationsEnabled()) {
      await tx.outboxMessage.upsert({
        where: { operationId_type: { operationId, type: "TELEGRAM_CAPTURED" } },
        update: {},
        create: {
          operationId,
          orderId,
          type: "TELEGRAM_CAPTURED",
          nextAttemptAt: new Date(0),
          payloadJson: JSON.stringify({ telegramId: order.user.telegramId, text: `✅ Заказ в «${order.bag.venue.name}» выдан. Приятного аппетита!` }),
        },
      });
    }
    await recordPaymentEvent(tx, { operationId, paymentId, orderId, provider, providerRef, type: "CAPTURE", status: "SUCCEEDED", amount });
    await succeedOperation(tx, operationId, leaseToken);
  });
}

/** Fresh reads inside the transaction prevent duplicate inventory restoration. */
async function finalizeRefund(operationId: string, leaseToken: string, paymentId: string, orderId: string, provider: string, providerRef: string, amount: number) {
  await prisma.$transaction(async (tx) => {
    await renewOperationLease(tx, operationId, leaseToken);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { bag: true } });
    if (!order) throw new OrderError("Заказ не найден");
    const finalStatus = (order.refundTargetStatus ?? "CANCELLED") as FinalRefundStatus;
    const transitioned = await transitionOrder(tx, {
      id: orderId,
      from: "REFUND_PENDING",
      to: finalStatus,
    });
    await tx.payment.update({ where: { id: paymentId }, data: { status: "REFUNDED" } });
    if (transitioned && finalStatus === "CANCELLED" && order.bag.pickupStart > new Date()) {
      // updateMany re-checks the row after it takes PostgreSQL's row lock. If
      // cancelBag won first, no quantity is restored and it stays CANCELLED.
      const restored = await tx.bag.updateMany({
        where: { id: order.bagId, status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupStart: { gt: new Date() } },
        data: { quantityLeft: { increment: order.quantity } },
      });
      if (restored.count) {
        await tx.bag.updateMany({
          where: { id: order.bagId, status: "SOLD_OUT", quantityLeft: { gt: 0 } },
          data: { status: "ACTIVE" },
        });
      }
    }
    await recordPaymentEvent(tx, { operationId, paymentId, orderId, provider, providerRef, type: "REFUND", status: "SUCCEEDED", amount });
    await succeedOperation(tx, operationId, leaseToken);
  });
}

async function declineHold(operationId: string, leaseToken: string, paymentId: string, orderId: string, bagId: string, quantity: number) {
  await prisma.$transaction(async (tx) => {
    await renewOperationLease(tx, operationId, leaseToken);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { bag: true } });
    if (order) {
      const finalStatus: FinalRefundStatus = order.bag.pickupEnd <= new Date() ? "EXPIRED" : "CANCELLED";
      const cancelled = await transitionOrder(tx, { id: orderId, from: "PENDING_PAYMENT", to: finalStatus });
      if (cancelled) {
        const restored = await tx.bag.updateMany({
          where: { id: bagId, status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupEnd: { gt: new Date() } },
          data: { quantityLeft: { increment: quantity } },
        });
        if (restored.count) {
          await tx.bag.updateMany({
            where: { id: bagId, status: "SOLD_OUT", quantityLeft: { gt: 0 } },
            data: { status: "ACTIVE" },
          });
        }
      }
    }
    await recordPaymentEvent(tx, { operationId, paymentId, orderId, provider: paymentProvider.name, type: "HOLD", status: "FAILED" });
    await succeedOperation(tx, operationId, leaseToken);
  });
}

async function retryOperation(id: string, leaseToken: string, previousAttempts: number, error: unknown): Promise<void> {
  const attempts = previousAttempts + 1;
  const exhausted = attempts >= MAX_PAYMENT_ATTEMPTS;
  const retryDelayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "PaymentOperation"
    SET attempts = ${attempts}, status = ${exhausted ? "NEEDS_REVIEW" : "RETRY"},
        "nextAttemptAt" = now() + (${retryDelayMs} * interval '1 millisecond'),
        "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${errorMessage(error)}
    WHERE id = ${id} AND status = 'PROCESSING' AND "leaseOwner" = ${leaseToken}
      AND "leaseExpiresAt" > now()
    RETURNING id
  `;
  if (updated.length && exhausted) console.error("PAYMENT_OPERATION_NEEDS_REVIEW", { operationId: id });
}

/**
 * Fences stale workers before they mutate local state. A provider call may
 * finish after its lease was claimed elsewhere; the current owner will then
 * reconcile the provider's idempotent result.
 */
async function renewOperationLease(tx: Prisma.TransactionClient, id: string, leaseToken: string): Promise<void> {
  const renewed = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "PaymentOperation"
    SET "leaseExpiresAt" = now() + interval '60 seconds'
    WHERE id = ${id} AND status = 'PROCESSING' AND "leaseOwner" = ${leaseToken}
      AND "leaseExpiresAt" > now()
    RETURNING id
  `;
  if (!renewed.length) throw new OperationLeaseLostError(`Payment operation lease lost: ${id}`);
}

async function succeedOperation(tx: Prisma.TransactionClient, id: string, leaseToken: string) {
  const succeeded = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "PaymentOperation"
    SET status = 'SUCCEEDED', "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
    WHERE id = ${id} AND status = 'PROCESSING' AND "leaseOwner" = ${leaseToken}
      AND "leaseExpiresAt" > now()
    RETURNING id
  `;
  if (!succeeded.length) throw new OperationLeaseLostError(`Payment operation lease lost: ${id}`);
}

async function recordPaymentEvent(tx: Prisma.TransactionClient, input: {
  operationId: string; paymentId: string; orderId: string; provider: string; providerRef?: string;
  type: OperationType; status: "SUCCEEDED" | "FAILED"; amount?: number;
}) {
  await tx.paymentEvent.upsert({
    where: { operationId: input.operationId },
    update: { paymentId: input.paymentId, orderId: input.orderId, provider: input.provider, providerRef: input.providerRef, type: input.type, status: input.status, amount: input.amount },
    create: { ...input, metadataJson: "{}" },
  });
}

export async function providerCall<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new PaymentProviderError("TIMEOUT", `Provider ${label} timed out`)), PAYMENT_PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown payment provider error";
}

async function createOrderRowWithUniqueCode(tx: Prisma.TransactionClient, data: {
  bagId: string;
  userId: string;
  quantity: number;
  totalPrice: number;
  platformFee: number;
  paymentMethod: "ONLINE" | "PAY_AT_PICKUP";
  status: "PENDING_PAYMENT" | "RESERVED";
  idempotencyRecordId?: string;
}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.order.create({ data: { ...data, pickupCode: generatePickupCode() } });
    } catch (error) {
      const collision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!collision || attempt >= 3) throw error;
    }
  }
}
