import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { paymentProvider } from "./payments";
import { generatePickupCode } from "./qr";
import { PLATFORM_FEE_PCT } from "./config";
import { sendTelegramMessage } from "./telegram";

export class OrderError extends Error {}

/**
 * Ленивое истечение (без cron в MVP): пакеты с прошедшим окном выдачи
 * помечаются EXPIRED, а любые неотоваренные оплаченные заказы с прошедшим
 * окном (независимо от статуса пакета) — авто-refund. Вызывается перед
 * чтением списков пакетов/заказов.
 */
export async function expireStale(): Promise<void> {
  const now = new Date();

  await prisma.bag.updateMany({
    where: { status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupEnd: { lt: now } },
    data: { status: "EXPIRED" },
  });

  const staleOrders = await prisma.order.findMany({
    where: { status: "PAID", bag: { pickupEnd: { lt: now } } },
    include: { payment: true },
  });
  for (const order of staleOrders) {
    await refundIfClaimed(order.id, order.payment?.id, "EXPIRED");
  }
}

/** Покупка: транзакционный резерв остатка → холд оплаты → PAID. */
export async function createOrder(userId: string, bagId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new OrderError("Некорректное количество");
  }

  // updateMany с условием quantityLeft >= quantity — атомарный резерв,
  // безопасный при конкурентных покупках последнего пакета
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
  } catch (cause) {
    await releaseQuantity(order.bagId, order.quantity);
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    throw new OrderError("Оплата не прошла, попробуйте ещё раз", { cause });
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

  const cancelled = await refundIfClaimed(order.id, order.payment?.id, "CANCELLED");
  if (!cancelled) throw new OrderError("Заказ нельзя отменить");

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
  if (order.bag.venue.ownerId !== merchantId)
    throw new OrderError("Код от другого заведения");
  if (order.status === "COMPLETED") throw new OrderError("Заказ уже выдан");
  if (order.status !== "PAID") throw new OrderError("Заказ не оплачен или отменён");

  // Атомарный переход PAID → COMPLETED: конкурентная повторная выдача
  // (два кассира, двойной тап) получает count 0 и отклоняется
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: "PAID" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (claimed.count === 0) throw new OrderError("Заказ уже выдан");

  if (order.payment) {
    // Для мок-провайдера capture безошибочен; у реального шлюза сбой здесь
    // требует ретрая/реконсиляции по статусу HELD — статус платежа это фиксирует
    await paymentProvider.capture(order.payment.providerRef);
    await prisma.payment.updateMany({
      where: { id: order.payment.id, status: "HELD" },
      data: { status: "CAPTURED" },
    });
  }

  const completed = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
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

/**
 * Снятие пакета с продажи мерчантом: все оплаченные заказы возвращаются
 * покупателям (иначе холды зависли бы до конца окна выдачи).
 */
export async function cancelBagWithRefunds(merchantId: string, bagId: string) {
  const bag = await prisma.bag.findUnique({ where: { id: bagId }, include: { venue: true } });
  if (!bag || bag.venue.ownerId !== merchantId) throw new OrderError("Пакет не найден");

  await prisma.bag.update({ where: { id: bagId }, data: { status: "CANCELLED" } });

  const paidOrders = await prisma.order.findMany({
    where: { bagId, status: "PAID" },
    include: { payment: true, user: true },
  });
  for (const order of paidOrders) {
    const cancelled = await refundIfClaimed(order.id, order.payment?.id, "CANCELLED");
    if (cancelled && order.user.telegramId) {
      await sendTelegramMessage(
        order.user.telegramId,
        `😔 «${bag.venue.name}» отменил пакет «${bag.title}». Деньги вернутся на карту.`
      );
    }
  }

  return prisma.bag.findUniqueOrThrow({ where: { id: bagId }, include: { venue: true } });
}

/**
 * Атомарно переводит PAID-заказ в конечный статус и возвращает холд.
 * false — заказ уже увели из PAID параллельным запросом (refund не дублируется).
 */
async function refundIfClaimed(
  orderId: string,
  paymentId: string | undefined,
  finalStatus: "CANCELLED" | "EXPIRED"
): Promise<boolean> {
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: "PAID" },
    data: { status: finalStatus },
  });
  if (claimed.count === 0) return false;

  if (paymentId) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (payment && payment.status === "HELD") {
      await paymentProvider.refund(payment.providerRef);
      await prisma.payment.updateMany({
        where: { id: paymentId, status: "HELD" },
        data: { status: "REFUNDED" },
      });
    }
  }
  return true;
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
    } catch (e) {
      const isCodeCollision =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!isCodeCollision || attempt >= 3) throw e;
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
