import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MockPaymentProvider, paymentProvider } from "@/lib/payments";
import {
  createOrder as queueOrder,
  cancelOrder as queueCancelOrder,
  redeemOrder as queueRedeemOrder,
  expireStale,
  customerOrderScopeWhere,
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
import { scheduleMissingPickupReminders } from "@/lib/notifications";
import { runBatchJobs } from "@/lib/jobs";
import { moderateReview, reconcileVenueRatings } from "@/lib/reviews";

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
  await runBatchJobs("refunds");
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

  it("листает каталог стабильным cursor без дублей", async () => {
    const { venue, bag } = await createFixtures();
    await prisma.bag.createMany({
      data: Array.from({ length: 14 }, (_, index) => ({
        venueId: venue.id,
        title: `Cursor ${index}`,
        price: 1000,
        originalPrice: 3000,
        quantityTotal: 1,
        quantityLeft: 1,
        pickupStart: inMinutes(30),
        pickupEnd: inMinutes(120),
      })),
    });
    const firstResponse = await getBags(new NextRequest("http://localhost/api/bags?city=almaty&sort=price&limit=10"));
    const first = await firstResponse.json();
    const secondResponse = await getBags(new NextRequest(`http://localhost/api/bags?city=almaty&sort=price&limit=10&cursor=${encodeURIComponent(first.nextCursor)}`));
    const second = await secondResponse.json();
    const ids = [...first.bags, ...second.bags].map((item: { id: string }) => item.id);
    expect(first.bags).toHaveLength(10);
    expect(new Set(ids).size).toBe(15);
    expect(ids).toContain(bag.id);
  });
});

describe("внутренние уведомления", () => {
  it("делает fan-out подписчикам отдельной batch job", async () => {
    const { customer, venue, bag } = await createFixtures();
    await prisma.favorite.create({ data: { userId: customer.id, venueId: venue.id } });
    await prisma.batchJob.create({
      data: { queue: "notifications", type: "FANOUT_NEW_BAG", payloadJson: JSON.stringify({ bagId: bag.id }), dedupeKey: `test-fanout:${bag.id}`, nextAttemptAt: new Date(0) },
    });
    await expect(runBatchJobs("notifications")).resolves.toBe(1);
    await expect(prisma.notification.findMany({ where: { userId: customer.id, type: "NEW_FAVORITE_VENUE_BAG" } })).resolves.toHaveLength(1);
  });

  it("считает успешные страницы отдельно от failure attempts", async () => {
    const { venue, bag } = await createFixtures();
    const followers = await Promise.all(Array.from({ length: 3 }, (_, index) => prisma.user.create({ data: { telegramId: `batch-follower-${index}` } })));
    await prisma.favorite.createMany({ data: followers.map((user) => ({ userId: user.id, venueId: venue.id })) });
    const job = await prisma.batchJob.create({
      data: { queue: "notifications", type: "FANOUT_NEW_BAG", payloadJson: JSON.stringify({ bagId: bag.id }), dedupeKey: `paged-fanout:${bag.id}`, nextAttemptAt: new Date(0) },
    });
    for (let page = 0; page < 4; page += 1) await runBatchJobs("notifications", 1, 1);
    await expect(prisma.batchJob.findUniqueOrThrow({ where: { id: job.id } })).resolves.toMatchObject({
      status: "SUCCEEDED",
      failureAttempts: 0,
      batchesProcessed: 4,
    });
  });

  it("создаёт одно напоминание перед выдачей и не дублирует его", async () => {
    const { customer, bag } = await createFixtures({ pickupStart: inMinutes(30), pickupEnd: inMinutes(90) });
    const order = await createOrder(customer.id, bag.id, 1);
    expect(order.status).toBe("PAID");
    await expect(runBatchJobs("notifications")).resolves.toBe(1);
    await expect(runBatchJobs("notifications")).resolves.toBe(0);
    await expect(prisma.notification.findMany({ where: { userId: customer.id, type: "PICKUP_REMINDER" } })).resolves.toHaveLength(1);
  });

  it("учитывает отключённые напоминания", async () => {
    const { customer, bag } = await createFixtures({ pickupStart: inMinutes(30), pickupEnd: inMinutes(90) });
    await prisma.user.update({ where: { id: customer.id }, data: { notificationReminders: false } });
    await createOrder(customer.id, bag.id, 1);
    await expect(runBatchJobs("notifications")).resolves.toBe(1);
    await expect(prisma.notification.count({ where: { type: "PICKUP_REMINDER" } })).resolves.toBe(0);
  });

  it("обрабатывает больше одного пакета по 500 заказов", async () => {
    const { customer, bag } = await createFixtures({ pickupStart: inMinutes(30), pickupEnd: inMinutes(90) });
    await prisma.order.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        bagId: bag.id,
        userId: customer.id,
        totalPrice: bag.price,
        platformFee: 0,
        status: "PAID",
        pickupCode: `R${String(index).padStart(5, "0")}`,
      })),
    });
    await expect(scheduleMissingPickupReminders()).resolves.toBe(500);
    await expect(runBatchJobs("notifications", 500)).resolves.toBe(500);
    await expect(scheduleMissingPickupReminders()).resolves.toBe(1);
    await expect(runBatchJobs("notifications", 10)).resolves.toBe(1);
    await expect(prisma.notification.count({ where: { type: "PICKUP_REMINDER" } })).resolves.toBe(501);
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

  it("выдаёт разным coroutine одного процесса разные lease token", async () => {
    const { customer, venue, bag } = await createFixtures();
    const secondBag = await prisma.bag.create({
      data: { venueId: venue.id, title: "Второй пакет", price: 900, originalPrice: 2700, quantityTotal: 2, quantityLeft: 2, pickupStart: inMinutes(60), pickupEnd: inMinutes(120) },
    });
    await queueOrder(customer.id, bag.id, 1);
    await queueOrder(customer.id, secondBag.id, 1);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalHold = paymentProvider.hold.bind(paymentProvider);
    vi.spyOn(paymentProvider, "hold").mockImplementation(async (amount, orderId, key) => {
      await gate;
      return originalHold(amount, orderId, key);
    });

    const processing = reconcilePendingPayments(10, "same-process");
    let claimed: Array<{ leaseOwner: string | null }> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      claimed = await prisma.paymentOperation.findMany({ where: { status: "PROCESSING" }, select: { leaseOwner: true } });
      if (claimed.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map((item) => item.leaseOwner)).size).toBe(2);
    expect(claimed.every((item) => item.leaseOwner?.startsWith("same-process:"))).toBe(true);
    release();
    await processing;
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
  it("сразу убирает заказ с завершённым окном из активных и показывает в истории", async () => {
    const { customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await prisma.bag.update({
      where: { id: bag.id },
      data: { pickupStart: inMinutes(-120), pickupEnd: inMinutes(-1) },
    });

    const [active, history] = await Promise.all([
      prisma.order.findMany({ where: customerOrderScopeWhere(customer.id, "active") }),
      prisma.order.findMany({ where: customerOrderScopeWhere(customer.id, "history") }),
    ]);

    expect(active).toHaveLength(0);
    expect(history.map((item) => item.id)).toContain(order.id);
  });

  it("не разрешает выдать заказ после окончания окна", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await prisma.bag.update({
      where: { id: bag.id },
      data: { pickupStart: inMinutes(-120), pickupEnd: inMinutes(-1) },
    });

    await expect(queueRedeemOrder(merchant.id, order.pickupCode)).rejects.toThrow("Окно выдачи закончилось");
    await expireStale();
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ status: "REFUND_PENDING" });
  });

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

  it("применяет delta рейтинга один раз при конкурентной модерации и умеет сверяться", async () => {
    const { merchant, customer, venue, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, order.pickupCode);
    const review = await prisma.review.create({ data: { orderId: order.id, userId: customer.id, venueId: venue.id, rating: 5 } });
    await prisma.venue.update({ where: { id: venue.id }, data: { ratingSum: 5, ratingCount: 1, ratingAverage: 5 } });

    await Promise.all([moderateReview(review.id, "HIDDEN"), moderateReview(review.id, "HIDDEN")]);
    await expect(prisma.venue.findUniqueOrThrow({ where: { id: venue.id } })).resolves.toMatchObject({ ratingSum: 0, ratingCount: 0, ratingAverage: 0 });

    await prisma.venue.update({ where: { id: venue.id }, data: { ratingSum: 99, ratingCount: 9, ratingAverage: 11 } });
    await reconcileVenueRatings();
    await expect(prisma.venue.findUniqueOrThrow({ where: { id: venue.id } })).resolves.toMatchObject({ ratingSum: 0, ratingCount: 0, ratingAverage: 0 });
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
