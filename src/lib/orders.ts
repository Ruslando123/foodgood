import { prisma } from "./db";
import { paymentProvider } from "./payments";
import { generatePickupCode } from "./qr";
import { PLATFORM_FEE_PCT } from "./config";
import { sendTelegramMessage } from "./telegram";

/**
 * Ленивое истечение (без cron в MVP): пакеты с прошедшим окном выдачи
 * помечаются EXPIRED, их неотоваренные оплаченные заказы — авто-refund.
 * Вызывается перед чтением списков пакетов/заказов.
 */
export async function expireStale(): Promise<void> {
  const now = new Date();
  const staleBags = await prisma.bag.findMany({
    where: { status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupEnd: { lt: now } },
    select: { id: true },
  });
  if (staleBags.length === 0) return;
  const bagIds = staleBags.map((b) => b.id);

  await prisma.bag.updateMany({
    where: { id: { in: bagIds } },
    data: { status: "EXPIRED" },
  });

  const staleOrders = await prisma.order.findMany({
    where: { bagId: { in: bagIds }, status: "PAID" },
    include: { payment: true },
  });
  for (const order of staleOrders) {
    if (order.payment && order.payment.status === "HELD") {
      await paymentProvider.refund(order.payment.providerRef);
      await prisma.payment.update({
        where: { id: order.payment.id },
        data: { status: "REFUNDED" },
      });
    }
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "EXPIRED" },
    });
  }
}

export class OrderError extends Error {}

/** Покупка: транзакционный декремент остатка → холд оплаты → PAID. */
export async function createOrder(userId: string, bagId: string, quantity: number) {
  if (quantity < 1 || quantity > 10) throw new OrderError("Некорректное количество");

  // Транзакционно резервируем остаток: updateMany с условием защищает от гонок
  const order = await prisma.$transaction(async (tx) => {
    const bag = await tx.bag.findUnique({ where: { id: bagId } });
    if (!bag || bag.status !== "ACTIVE") throw new OrderError("Пакет недоступен");
    if (bag.pickupEnd < new Date()) throw new OrderError("Окно выдачи уже закончилось");

    const reserved = await tx.bag.updateMany({
      where: { id: bagId, quantityLeft: { gte: quantity } },
      data: { quantityLeft: { decrement: quantity } },
    });
    if (reserved.count === 0) throw new OrderError("Столько пакетов уже не осталось");

    const updated = await tx.bag.findUniqueOrThrow({ where: { id: bagId } });
    if (updated.quantityLeft === 0) {
      await tx.bag.update({ where: { id: bagId }, data: { status: "SOLD_OUT" } });
    }

    const totalPrice = bag.price * quantity;
    return tx.order.create({
      data: {
        bagId,
        userId,
        quantity,
        totalPrice,
        platformFee: Math.round(totalPrice * PLATFORM_FEE_PCT),
        pickupCode: generatePickupCode(),
        status: "PENDING_PAYMENT",
      },
    });
  });

  // Холдируем оплату; при отказе шлюза — возвращаем остаток и отменяем заказ
  try {
    const { providerRef } = await paymentProvider.hold(order.totalPrice, order.id);
    await prisma.$transaction([
      prisma.payment.create({
        data: {
          orderId: order.id,
          provider: paymentProvider.name,
          providerRef,
          amount: order.totalPrice,
          status: "HELD",
        },
      }),
      prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } }),
    ]);
  } catch {
    await releaseQuantity(order.bagId, order.quantity);
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    throw new OrderError("Оплата не прошла, попробуйте ещё раз");
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
  if (order.bag.pickupStart <= new Date())
    throw new OrderError("Окно выдачи уже началось — отмена недоступна");

  if (order.payment && order.payment.status === "HELD") {
    await paymentProvider.refund(order.payment.providerRef);
    await prisma.payment.update({
      where: { id: order.payment.id },
      data: { status: "REFUNDED" },
    });
  }
  await releaseQuantity(order.bagId, order.quantity);
  return prisma.order.update({
    where: { id: orderId },
    data: { status: "CANCELLED" },
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
  if (order.bag.venue.ownerId !== merchantId)
    throw new OrderError("Код от другого заведения");
  if (order.status === "COMPLETED") throw new OrderError("Заказ уже выдан");
  if (order.status !== "PAID") throw new OrderError("Заказ не оплачен или отменён");

  if (order.payment && order.payment.status === "HELD") {
    await paymentProvider.capture(order.payment.providerRef);
    await prisma.payment.update({
      where: { id: order.payment.id },
      data: { status: "CAPTURED" },
    });
  }
  const completed = await prisma.order.update({
    where: { id: order.id },
    data: { status: "COMPLETED", completedAt: new Date() },
    include: { bag: { include: { venue: true } }, payment: true, user: true },
  });

  if (completed.user.telegramId) {
    await sendTelegramMessage(
      completed.user.telegramId,
      `✅ Заказ в «${completed.bag.venue.name}» выдан. Приятного аппетита!`
    );
  }
  return completed;
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
