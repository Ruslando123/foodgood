import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MockPaymentProvider, paymentProvider } from "@/lib/payments";
import {
  createOrder as queueOrder,
  cancelOrder as queueCancelOrder,
  redeemOrder as queueRedeemOrder,
  expireStale,
  cancelBagWithRefunds as queueCancelBagWithRefunds,
  reconcilePendingPayments,
  OrderError,
} from "@/modules/orders";
import { PLATFORM_FEE_PCT } from "@/lib/config";
import { dispatchOutbox } from "@/lib/outbox";
import { consumeOtp, issueOtp } from "@/lib/otp";
import { consumeRateLimit } from "@/shared/server/rate-limit";
import { resetDb, createFixtures, inMinutes } from "./helpers";
import { NextRequest } from "next/server";
import { GET as getBags } from "@/app/api/bags/route";
import { POST as verifyPhone } from "@/app/api/auth/verify/route";
import { createPickupReminders } from "@/lib/notifications";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

// Most lifecycle assertions below concern the settled business result. The
// public functions now intentionally return intermediate states, so settle
// them through the same reconcile entrypoint a cron invocation uses.
async function createOrder(userId: string, bagId: string, quantity: number) {
  const order = await queueOrder(userId, bagId, quantity);
  await reconcilePendingPayments();
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true } });
}

async function redeemOrder(merchantId: string, pickupCode: string) {
  const order = await queueRedeemOrder(merchantId, pickupCode);
  await reconcilePendingPayments();
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true } });
}

async function cancelOrder(userId: string, orderId: string) {
  const order = await queueCancelOrder(userId, orderId);
  await reconcilePendingPayments();
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true } });
}

async function cancelBagWithRefunds(merchantId: string, bagId: string) {
  const bag = await queueCancelBagWithRefunds(merchantId, bagId);
  await reconcilePendingPayments();
  return bag;
}

describe("каталог по городу", () => {
  it("не показывает пакет Астаны в каталоге Алматы", async () => {
    const { merchant, bag: almatyBag } = await createFixtures();
    const astanaVenue = await prisma.venue.create({
      data: { name: "Пекарня Астаны", address: "Астана", lat: 51.1694, lng: 71.4491, cityId: "astana", ownerId: merchant.id },
    });
    const astanaBag = await prisma.bag.create({
      data: { venueId: astanaVenue.id, title: "Пакет Астаны", price: 1000, originalPrice: 3000, quantityTotal: 2, quantityLeft: 2, pickupStart: inMinutes(30), pickupEnd: inMinutes(120) },
    });

    const almatyResponse = await getBags(new NextRequest("http://localhost/api/bags?city=almaty"));
    const almatyData = await almatyResponse.json();
    expect(almatyData.bags.map((bag: { id: string }) => bag.id)).toEqual([almatyBag.id]);

    const astanaResponse = await getBags(new NextRequest("http://localhost/api/bags?city=astana"));
    const astanaData = await astanaResponse.json();
    expect(astanaData.bags.map((bag: { id: string }) => bag.id)).toEqual([astanaBag.id]);
  });
});

describe("внутренние уведомления", () => {
  it("создаёт одно напоминание перед выдачей и не дублирует его", async () => {
    const { customer, bag } = await createFixtures({ pickupStart: inMinutes(30), pickupEnd: inMinutes(90) });
    const order = await createOrder(customer.id, bag.id, 1);
    expect(order.status).toBe("PAID");
    await expect(createPickupReminders()).resolves.toBe(1);
    await expect(createPickupReminders()).resolves.toBe(0);
    await expect(prisma.notification.findMany({ where: { userId: customer.id, type: "PICKUP_REMINDER" } })).resolves.toHaveLength(1);
  });

  it("учитывает отключённые напоминания", async () => {
    const { customer, bag } = await createFixtures({ pickupStart: inMinutes(30), pickupEnd: inMinutes(90) });
    await prisma.user.update({ where: { id: customer.id }, data: { notificationReminders: false } });
    await createOrder(customer.id, bag.id, 1);
    await expect(createPickupReminders()).resolves.toBe(0);
  });
});

describe("createOrder", () => {
  it("возвращает PENDING_PAYMENT до запуска worker", async () => {
    const { customer, bag } = await createFixtures();
    const order = await queueOrder(customer.id, bag.id, 1);
    expect(order.status).toBe("PENDING_PAYMENT");
    await expect(prisma.paymentOperation.findFirstOrThrow({ where: { payment: { orderId: order.id } } }))
      .resolves.toMatchObject({ type: "HOLD", status: "PENDING" });
  });
  it("резервирует остаток, холдирует оплату и фиксирует комиссию", async () => {
    const { customer, bag } = await createFixtures({ price: 1500, quantity: 5 });

    const order = await createOrder(customer.id, bag.id, 2);

    expect(order.status).toBe("PAID");
    expect(order.totalPrice).toBe(3000);
    expect(order.platformFee).toBe(Math.round(3000 * PLATFORM_FEE_PCT));
    expect(order.pickupCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(order.payment?.status).toBe("HELD");
    expect(order.payment?.amount).toBe(3000);

    const updatedBag = await prisma.bag.findUniqueOrThrow({ where: { id: bag.id } });
    expect(updatedBag.quantityLeft).toBe(3);
    expect(updatedBag.status).toBe("ACTIVE");
  });

  it("помечает пакет SOLD_OUT при выкупе последнего", async () => {
    const { customer, bag } = await createFixtures({ quantity: 2 });

    await createOrder(customer.id, bag.id, 2);

    const updatedBag = await prisma.bag.findUniqueOrThrow({ where: { id: bag.id } });
    expect(updatedBag.quantityLeft).toBe(0);
    expect(updatedBag.status).toBe("SOLD_OUT");
  });

  it("не даёт купить больше остатка (и не портит остаток)", async () => {
    const { customer, bag } = await createFixtures({ quantity: 3 });

    await expect(createOrder(customer.id, bag.id, 4)).rejects.toThrow(OrderError);

    const updatedBag = await prisma.bag.findUniqueOrThrow({ where: { id: bag.id } });
    expect(updatedBag.quantityLeft).toBe(3);
  });

  it("параллельные покупки не уводят остаток в минус", async () => {
    const { customer, bag } = await createFixtures({ quantity: 3 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        queueOrder(customer.id, bag.id, 1).then(
          () => "ok",
          () => "rejected"
        )
      )
    );

    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    const updatedBag = await prisma.bag.findUniqueOrThrow({ where: { id: bag.id } });
    expect(updatedBag.quantityLeft).toBe(0);
    expect(updatedBag.status).toBe("SOLD_OUT");
  });

  it("отклоняет просроченный пакет и некорректное количество", async () => {
    const { customer, bag } = await createFixtures({
      pickupStart: inMinutes(-120),
      pickupEnd: inMinutes(-60),
    });

    await expect(createOrder(customer.id, bag.id, 1)).rejects.toThrow("Окно выдачи");
    await expect(createOrder(customer.id, bag.id, 0)).rejects.toThrow("количество");
    await expect(createOrder(customer.id, bag.id, 1.5)).rejects.toThrow("количество");
    await expect(createOrder(customer.id, bag.id, 11)).rejects.toThrow("количество");
  });

  it("отклоняет неактивный пакет", async () => {
    const { customer, bag } = await createFixtures({ bagStatus: "CANCELLED" });
    await expect(createOrder(customer.id, bag.id, 1)).rejects.toThrow("недоступен");
  });
});

describe("redeemOrder (выдача по коду)", () => {
  it("capture холда и завершение заказа", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);

    const redeemed = await redeemOrder(merchant.id, order.pickupCode);

    expect(redeemed.status).toBe("COMPLETED");
    expect(redeemed.completedAt).not.toBeNull();
    expect(redeemed.payment?.status).toBe("CAPTURED");
  });

  it("принимает код в нижнем регистре и с пробелами", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);

    const redeemed = await redeemOrder(merchant.id, `  ${order.pickupCode.toLowerCase()} `);
    expect(redeemed.status).toBe("COMPLETED");
  });

  it("не выдаёт заказ дважды", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);

    await redeemOrder(merchant.id, order.pickupCode);
    await expect(redeemOrder(merchant.id, order.pickupCode)).rejects.toThrow("уже выдан");
  });

  it("повторный worker не дублирует PaymentEvent и capture outbox", async () => {
    const { merchant, customer, bag } = await createFixtures();
    await prisma.user.update({ where: { id: customer.id }, data: { telegramId: "42" } });
    const order = await createOrder(customer.id, bag.id, 1);
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;
    const previousEnabled = process.env.TELEGRAM_NOTIFICATIONS_ENABLED;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "true";
    await queueRedeemOrder(merchant.id, order.pickupCode);

    await reconcilePendingPayments();
    await reconcilePendingPayments();

    const capture = await prisma.paymentOperation.findUniqueOrThrow({
      where: { paymentId_type: { paymentId: order.payment!.id, type: "CAPTURE" } },
    });
    await expect(prisma.paymentEvent.count({ where: { operationId: capture.id } })).resolves.toBe(1);
    await expect(prisma.outboxMessage.count({ where: { operationId: capture.id, type: "TELEGRAM_CAPTURED" } })).resolves.toBe(1);

    process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      await expect(dispatchOutbox()).resolves.toBe(0);
    } finally {
      if (previousToken) process.env.TELEGRAM_BOT_TOKEN = previousToken;
      else delete process.env.TELEGRAM_BOT_TOKEN;
      if (previousEnabled) process.env.TELEGRAM_NOTIFICATIONS_ENABLED = previousEnabled;
      else delete process.env.TELEGRAM_NOTIFICATIONS_ENABLED;
    }
    await expect(prisma.outboxMessage.findFirstOrThrow({ where: { operationId: capture.id } }))
      .resolves.toMatchObject({ status: "SKIPPED" });
  });

  it("reconciliation восстанавливает capture после сбоя БД и два worker не дублируют claim", async () => {
    const { customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.providerRef).not.toBeNull();
    await paymentProvider.capture(payment.providerRef!, "provider-succeeded-before-db-failure");
    await prisma.order.update({ where: { id: order.id }, data: { status: "CAPTURE_PENDING" } });
    const operation = await prisma.paymentOperation.create({
      data: { paymentId: payment.id, type: "CAPTURE", idempotencyKey: crypto.randomUUID(), status: "RETRY" },
    });

    await Promise.all([
      reconcilePendingPayments(10, "worker-a"),
      reconcilePendingPayments(10, "worker-b"),
    ]);

    await expect(prisma.paymentOperation.findUniqueOrThrow({ where: { id: operation.id } }))
      .resolves.toMatchObject({ status: "SUCCEEDED", attempts: 0 });
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("не помечает заказ выданным, если capture не подтверждён", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    vi.spyOn(paymentProvider, "capture").mockRejectedValueOnce(new Error("provider timeout"));

    const queued = await redeemOrder(merchant.id, order.pickupCode);
    expect(queued.status).toBe("CAPTURE_PENDING");

    const pending = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(pending.status).toBe("CAPTURE_PENDING");
    expect(pending.payment?.status).toBe("HELD");
    await prisma.paymentOperation.updateMany({
      where: { paymentId: pending.payment!.id, type: "CAPTURE" },
      data: { nextAttemptAt: new Date(0) },
    });
    await reconcilePendingPayments();
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("чужой мерчант не может выдать заказ", async () => {
    const { customer, bag } = await createFixtures();
    const stranger = await prisma.user.create({
      data: { phone: "+77010008888", role: "MERCHANT" },
    });
    const order = await createOrder(customer.id, bag.id, 1);

    await expect(redeemOrder(stranger.id, order.pickupCode)).rejects.toThrow(
      "другого заведения"
    );
  });

  it("несуществующий код отклоняется", async () => {
    const { merchant } = await createFixtures();
    await expect(redeemOrder(merchant.id, "AAAAAA")).rejects.toThrow("не найден");
  });
});

describe("phone OTP", () => {
  it("выдаёт одноразовый dev-код и запрещает повторное использование", async () => {
    const phone = "+77010001234";
    const issued = await issueOtp(phone);
    expect(issued).toMatchObject({ codeLength: 4, devCode: "0000" });
    await expect(consumeOtp(phone, "0000")).resolves.toBeUndefined();
    await expect(consumeOtp(phone, "0000")).rejects.toThrow("Неверный код");
  });

  it("считает неверные попытки", async () => {
    const phone = "+77010005678";
    await issueOtp(phone);
    await expect(consumeOtp(phone, "1111")).rejects.toThrow("Неверный код");
    await expect(prisma.otpChallenge.findFirstOrThrow({ where: { phone } }))
      .resolves.toMatchObject({ attempts: 1, consumedAt: null });
  });

  it("сериализует параллельные запросы одного кода", async () => {
    const phone = "+77010007890";
    const results = await Promise.allSettled([issueOtp(phone), issueOtp(phone)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(prisma.otpChallenge.count({ where: { phone, activeKey: phone } })).resolves.toBe(1);
  });

  it("не создаёт сессию для заблокированного аккаунта", async () => {
    const phone = "+77015550199";
    await prisma.user.create({ data: { phone, status: "BLOCKED" } });
    const issued = await issueOtp(phone);
    const response = await verifyPhone(new NextRequest("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ phone, code: issued.devCode }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ACCOUNT_BLOCKED" } });
  });
});

describe("distributed rate limit", () => {
  it("атомарно ограничивает параллельные запросы", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => consumeRateLimit(key, { limit: 3, windowMs: 60_000 }))
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);
  });
});

describe("cancelOrder (отмена покупателем)", () => {
  it("возвращает деньги и остаток, снимает SOLD_OUT", async () => {
    const { customer, bag } = await createFixtures({ quantity: 1 });
    const order = await createOrder(customer.id, bag.id, 1);

    const soldOut = await prisma.bag.findUniqueOrThrow({ where: { id: bag.id } });
    expect(soldOut.status).toBe("SOLD_OUT");

    const cancelled = await cancelOrder(customer.id, order.id);

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.payment?.status).toBe("REFUNDED");
    const restored = await prisma.bag.findUniqueOrThrow({ where: { id: bag.id } });
    expect(restored.quantityLeft).toBe(1);
    expect(restored.status).toBe("ACTIVE");
  });

  it("нельзя отменить после начала окна выдачи", async () => {
    const { customer, bag } = await createFixtures({
      pickupStart: inMinutes(-10),
      pickupEnd: inMinutes(50),
    });
    const order = await createOrder(customer.id, bag.id, 1);

    await expect(cancelOrder(customer.id, order.id)).rejects.toThrow("уже началось");
  });

  it("чужой заказ отменить нельзя", async () => {
    const { customer, bag } = await createFixtures();
    const stranger = await prisma.user.create({ data: { phone: "+77070008888" } });
    const order = await createOrder(customer.id, bag.id, 1);

    await expect(cancelOrder(stranger.id, order.id)).rejects.toThrow("не найден");
  });

  it("выданный заказ отменить нельзя", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, order.pickupCode);

    await expect(cancelOrder(customer.id, order.id)).rejects.toThrow("нельзя отменить");
  });

  it("оставляет возврат в обработке при ошибке провайдера", async () => {
    const { customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    vi.spyOn(paymentProvider, "refund").mockRejectedValueOnce(new Error("provider timeout"));

    const queued = await cancelOrder(customer.id, order.id);
    expect(queued.status).toBe("REFUND_PENDING");

    const pending = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(pending.status).toBe("REFUND_PENDING");
    expect(pending.refundTargetStatus).toBe("CANCELLED");
    expect(pending.payment?.status).toBe("HELD");
    await prisma.paymentOperation.updateMany({
      where: { paymentId: pending.payment!.id, type: "REFUND" },
      data: { nextAttemptAt: new Date(0) },
    });
    await reconcilePendingPayments();
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .resolves.toMatchObject({ status: "CANCELLED" });
  });
});

describe("cancelBagWithRefunds (мерчант снимает пакет)", () => {
  it("возвращает деньги всем оплаченным заказам", async () => {
    const { merchant, customer, bag } = await createFixtures({ quantity: 5 });
    const order1 = await createOrder(customer.id, bag.id, 1);
    const order2 = await createOrder(customer.id, bag.id, 2);

    const cancelledBag = await cancelBagWithRefunds(merchant.id, bag.id);
    expect(cancelledBag.status).toBe("CANCELLED");

    for (const id of [order1.id, order2.id]) {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id },
        include: { payment: true },
      });
      expect(order.status).toBe("CANCELLED");
      expect(order.payment?.status).toBe("REFUNDED");
    }
  });

  it("выданные заказы не трогает", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, order.pickupCode);

    await cancelBagWithRefunds(merchant.id, bag.id);

    const completed = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.payment?.status).toBe("CAPTURED");
  });

  it("чужой мерчант не может снять пакет", async () => {
    const { bag } = await createFixtures();
    const stranger = await prisma.user.create({
      data: { phone: "+77010007777", role: "MERCHANT" },
    });
    await expect(cancelBagWithRefunds(stranger.id, bag.id)).rejects.toThrow("не найден");
  });

  it("после снятия пакет купить нельзя", async () => {
    const { merchant, customer, bag } = await createFixtures();
    await cancelBagWithRefunds(merchant.id, bag.id);
    await expect(createOrder(customer.id, bag.id, 1)).rejects.toThrow("недоступен");
  });

  it("отменяет заказ, ожидающий фиксации оплаты", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const pending = await prisma.order.create({
      data: {
        bagId: bag.id,
        userId: customer.id,
        quantity: 1,
        totalPrice: bag.price,
        platformFee: Math.round(bag.price * PLATFORM_FEE_PCT),
        pickupCode: "PENDING",
        status: "PENDING_PAYMENT",
      },
    });

    await cancelBagWithRefunds(merchant.id, bag.id);

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: pending.id } })
    ).resolves.toMatchObject({ status: "CANCELLED" });
  });
});

describe("expireStale (ленивое истечение)", () => {
  it("просроченный пакет → EXPIRED, невыданный заказ → refund", async () => {
    const { customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);

    // Окно выдачи прошло, заказ не забрали
    await prisma.bag.update({
      where: { id: bag.id },
      data: { pickupStart: inMinutes(-120), pickupEnd: inMinutes(-60) },
    });

    await expireStale();
    await reconcilePendingPayments();

    const expiredBag = await prisma.bag.findUniqueOrThrow({ where: { id: bag.id } });
    expect(expiredBag.status).toBe("EXPIRED");

    const expiredOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(expiredOrder.status).toBe("EXPIRED");
    expect(expiredOrder.payment?.status).toBe("REFUNDED");
  });

  it("возвращает деньги и по заказам отменённых пакетов с прошедшим окном", async () => {
    const { customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    // Пакет отменён напрямую в БД (минуя cancelBagWithRefunds) — страховка
    await prisma.bag.update({
      where: { id: bag.id },
      data: { status: "CANCELLED", pickupStart: inMinutes(-120), pickupEnd: inMinutes(-60) },
    });

    await expireStale();
    await reconcilePendingPayments();

    const expiredOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(expiredOrder.status).toBe("EXPIRED");
    expect(expiredOrder.payment?.status).toBe("REFUNDED");
  });

  it("выданные и активные заказы не трогает", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const completedOrder = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, completedOrder.pickupCode);
    const activeOrder = await createOrder(customer.id, bag.id, 1);

    await expireStale();

    const completed = await prisma.order.findUniqueOrThrow({ where: { id: completedOrder.id } });
    const active = await prisma.order.findUniqueOrThrow({ where: { id: activeOrder.id } });
    expect(completed.status).toBe("COMPLETED");
    expect(active.status).toBe("PAID");
  });

  it("идемпотентен", async () => {
    const { customer, bag } = await createFixtures();
    await createOrder(customer.id, bag.id, 1);
    await prisma.bag.update({
      where: { id: bag.id },
      data: { pickupStart: inMinutes(-120), pickupEnd: inMinutes(-60) },
    });

    await expireStale();
    await reconcilePendingPayments();
    await expireStale(); // повторный вызов не должен ломаться и дублировать refund
    await reconcilePendingPayments();

    const payments = await prisma.payment.findMany();
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("REFUNDED");
  });
});

describe("расширенные продуктовые сценарии", () => {
  it("выдаёт заказ после отметки READY_FOR_PICKUP", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await prisma.order.update({ where: { id: order.id }, data: { status: "READY_FOR_PICKUP" } });
    const completed = await redeemOrder(merchant.id, order.pickupCode);
    expect(completed.status).toBe("COMPLETED");
  });

  it("не позволяет добавить одно заведение в избранное дважды", async () => {
    const { customer, venue } = await createFixtures();
    await prisma.favorite.create({ data: { userId: customer.id, venueId: venue.id } });
    await expect(prisma.favorite.create({ data: { userId: customer.id, venueId: venue.id } })).rejects.toThrow();
  });

  it("связывает отзыв с выданным заказом и заведением", async () => {
    const { merchant, customer, venue, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, order.pickupCode);
    const review = await prisma.review.create({ data: { orderId: order.id, userId: customer.id, venueId: venue.id, rating: 5, comment: "Отлично" } });
    expect(review).toMatchObject({ rating: 5, moderationStatus: "PUBLISHED" });
    await expect(prisma.review.create({ data: { orderId: order.id, userId: customer.id, venueId: venue.id, rating: 4 } })).rejects.toThrow();
  });
});

describe("mock payment provider после перезапуска", () => {
  it("восстанавливает неизвестный mock reference и выполняет capture", async () => {
    const provider = new MockPaymentProvider();
    const reference = "mock_order_after_restart";
    expect(await provider.getStatus(reference)).toBe("HELD");
    await provider.capture(reference, "capture-key");
    expect(await provider.getStatus(reference)).toBe("CAPTURED");
  });

  it("восстанавливает неизвестный mock reference и выполняет refund", async () => {
    const provider = new MockPaymentProvider();
    const reference = "mock_order_after_restart";
    await provider.refund(reference, "refund-key");
    expect(await provider.getStatus(reference)).toBe("REFUNDED");
  });
});
