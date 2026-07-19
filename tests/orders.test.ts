import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cancelBag,
  cancelOrder,
  cancelOrderByPartner,
  createOrder,
  customerOrderScopeWhere,
  expireStale,
  markOrderReady,
  OrderError,
  redeemOrder,
} from "@/modules/orders";
import {
  customerOrderSelect,
  merchantOrderSelect,
  toCustomerOrderDto,
  toMerchantOrderDto,
} from "@/modules/api/dto";
import { idempotentOrderRequest } from "@/modules/orders/idempotency";
import { enqueueBatchJob, runBatchJobs } from "@/lib/jobs";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { createFixtures, inMinutes, resetDb } from "./helpers";

const qrMock = vi.hoisted(() => ({ pickupCodes: [] as string[] }));
vi.mock("@/lib/qr", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/qr")>();
  return {
    ...original,
    generatePickupCode: () => qrMock.pickupCodes.shift() ?? original.generatePickupCode(),
  };
});

beforeEach(() => resetDb());

afterEach(() => {
  qrMock.pickupCodes.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("бесплатная бронь", () => {
  it("резервирует остаток без платёжных сущностей и ставит напоминание", async () => {
    const { customer, bag } = await createFixtures({ price: 1800, quantity: 3 });

    const order = await createOrder(customer.id, bag.id, 2, undefined, undefined, "telegram");

    expect(order).toMatchObject({
      status: "RESERVED",
      quantity: 2,
      totalPrice: 3600,
      clientSource: "telegram",
    });
    expect(order.pickupCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({
      quantityLeft: 1,
      status: "ACTIVE",
    });
    await expect(prisma.batchJob.findUnique({
      where: { dedupeKey: `pickup-reminder:${order.id}` },
    })).resolves.toMatchObject({ queue: "notifications", type: "PICKUP_REMINDER" });
    await expect(prisma.productEvent.findUnique({
      where: { dedupeKey: `order_created:${order.id}` },
    })).resolves.toMatchObject({ amount: 3600, quantity: 2 });
    await expect(prisma.orderStatusHistory.findMany({ where: { orderId: order.id } })).resolves.toEqual([
      expect.objectContaining({
        status: "RESERVED",
        actor: customer.id,
        actorRole: "CUSTOMER",
        reason: "RESERVATION_CREATED",
        timestamp: expect.any(Date),
      }),
    ]);
  });

  it("не позволяет продать последний пакет двум клиентам", async () => {
    const { customer, bag } = await createFixtures({ quantity: 1 });
    const secondCustomer = await prisma.user.create({
      data: { phone: "+77070008888", role: "CUSTOMER" },
    });

    const results = await Promise.allSettled([
      createOrder(customer.id, bag.id, 1),
      createOrder(secondCustomer.id, bag.id, 1),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(prisma.order.count()).resolves.toBe(1);
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({
      quantityLeft: 0,
      status: "SOLD_OUT",
    });
  });

  it("не резервирует пакет, если окно закончилось в очереди за блокировкой", async () => {
    const { customer, bag } = await createFixtures({ quantity: 1 });
    await prisma.bag.update({
      where: { id: bag.id },
      data: { pickupStart: new Date(Date.now() - 1_000), pickupEnd: new Date(Date.now() + 1_000) },
    });
    let releaseLock!: () => void;
    let reportLocked!: () => void;
    const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${bag.id} FOR UPDATE`;
      reportLocked();
      await release;
    });

    await locked;
    const reservation = createOrder(customer.id, bag.id, 1);
    const rejected = expect(reservation).rejects.toThrow("выдачи уже закончилось");
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    releaseLock();
    await blocker;

    await rejected;
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ quantityLeft: 1 });
  });

  it("откатывает остаток при коллизии pickup-кода и повторяет бронь", async () => {
    const { customer, bag } = await createFixtures({ quantity: 2 });
    await prisma.order.create({
      data: {
        bagId: bag.id,
        userId: customer.id,
        quantity: 1,
        totalPrice: bag.price,
        pickupCode: "COLLIDE",
      },
    });
    qrMock.pickupCodes.push("COLLIDE", "UNIQUE");

    const order = await createOrder(customer.id, bag.id, 1);

    expect(order.pickupCode).toBe("UNIQUE");
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ quantityLeft: 1 });
    await expect(prisma.batchJob.count({ where: { type: "PICKUP_REMINDER" } })).resolves.toBe(1);
    await expect(prisma.productEvent.count({ where: { bagId: bag.id, name: "order_created" } })).resolves.toBe(1);
  });

  it("атомарно создаёт брони, напоминания и события при высокой конкуренции", async () => {
    const reservationCount = 20;
    const { bag } = await createFixtures({ quantity: reservationCount });
    const customers = await Promise.all(
      Array.from({ length: reservationCount }, (_, index) =>
        prisma.user.create({ data: { phone: `+7707111${String(index).padStart(4, "0")}`, role: "CUSTOMER" } })
      )
    );

    const orders = await Promise.all(customers.map((customer) => createOrder(customer.id, bag.id, 1)));

    expect(new Set(orders.map(({ pickupCode }) => pickupCode)).size).toBe(reservationCount);
    await expect(prisma.order.count({ where: { bagId: bag.id, status: "RESERVED" } })).resolves.toBe(reservationCount);
    await expect(prisma.batchJob.count({ where: { type: "PICKUP_REMINDER" } })).resolves.toBe(reservationCount);
    await expect(prisma.productEvent.count({ where: { bagId: bag.id, name: "order_created" } })).resolves.toBe(
      reservationCount
    );
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({
      quantityLeft: 0,
      status: "SOLD_OUT",
    });
  });

  it("не держит блокировку пакета между запросами к базе", async () => {
    const { customer, bag } = await createFixtures({ quantity: 2 });
    const statements: string[] = [];
    let capture = true;
    prisma.$on("query", (event) => {
      if (capture) statements.push(event.query);
    });

    await createOrder(customer.id, bag.id, 1);
    capture = false;

    const reservationStatements = statements.filter((query) => query.includes('UPDATE "Bag" bag'));
    expect(reservationStatements).toHaveLength(1);
    expect(reservationStatements[0]).toContain('INSERT INTO "Order"');
    expect(reservationStatements[0]).toContain('INSERT INTO "BatchJob"');
    expect(reservationStatements[0]).toContain('INSERT INTO "ProductEvent"');
    expect(reservationStatements[0]).toMatch(/locked_bag[\s\S]+FOR\s+UPDATE OF candidate/i);
    const reservationIndex = statements.indexOf(reservationStatements[0]);
    const commitIndex = statements.findIndex((query) => query.trim().toUpperCase() === "COMMIT");
    expect(commitIndex).toBeGreaterThan(reservationIndex);
    expect(statements.slice(commitIndex + 1).some((query) => query.includes('FROM "public"."Order"'))).toBe(true);
  });

  it("возвращает остаток при отмене до начала выдачи", async () => {
    const { customer, bag } = await createFixtures({ quantity: 1 });
    const order = await createOrder(customer.id, bag.id, 1);

    const cancelled = await cancelOrder(customer.id, order.id);

    expect(cancelled.status).toBe("CANCELLED_BY_USER");
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({
      quantityLeft: 1,
      status: "ACTIVE",
    });
    await expect(prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { timestamp: "asc" } })).resolves.toMatchObject([
      { status: "RESERVED" },
      { status: "CANCELLED_BY_USER", actor: customer.id, actorRole: "CUSTOMER", reason: "CUSTOMER_REQUEST" },
    ]);
  });

  it("не создаёт новую бронь у приостановленного заведения", async () => {
    const { customer, venue, bag } = await createFixtures({ quantity: 2 });
    await prisma.venue.update({ where: { id: venue.id }, data: { status: "SUSPENDED" } });

    await expect(createOrder(customer.id, bag.id, 1)).rejects.toThrow("временно недоступно");
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ quantityLeft: 2 });
  });

  it("не создаёт бронь после приостановки юридического партнёра", async () => {
    const { customer, partner, bag } = await createFixtures({ quantity: 2 });
    await prisma.partnerBusiness.update({ where: { id: partner.id }, data: { verificationStatus: "SUSPENDED" } });

    await expect(createOrder(customer.id, bag.id, 1)).rejects.toThrow("Пакет недоступен");
    await expect(prisma.order.count()).resolves.toBe(0);
  });

  it("не создаёт бронь без полного snapshot подтверждений безопасности", async () => {
    const { customer, bag } = await createFixtures({ quantity: 2 });
    await prisma.bag.update({ where: { id: bag.id }, data: { allergensCurrentAttested: false } });

    await expect(createOrder(customer.id, bag.id, 1)).rejects.toThrow("Пакет недоступен");
    await expect(prisma.order.count()).resolves.toBe(0);
  });

  it("проверяет начало выдачи внутри транзакции отмены", async () => {
    const { customer, bag } = await createFixtures({ pickupStart: inMinutes(-1), pickupEnd: inMinutes(60) });
    const order = await createOrder(customer.id, bag.id, 1);

    await expect(cancelOrder(customer.id, order.id)).rejects.toThrow("выдачи уже началось");
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ status: "RESERVED" });
  });
});

describe("выдача в заведении", () => {
  it("требует подтверждение оплаты на кассе и завершает бронь", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);

    await expect(redeemOrder(merchant.id, order.pickupCode)).rejects.toThrow(
      "Подтвердите получение оплаты"
    );
    const completed = await redeemOrder(merchant.id, order.pickupCode, true);

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeInstanceOf(Date);
    await expect(redeemOrder(merchant.id, order.pickupCode, true)).rejects.toThrow("уже выдан");
    await expect(prisma.pickupJournal.findUniqueOrThrow({ where: { orderId: order.id } })).resolves.toMatchObject({
      actor: merchant.id,
      actorRole: "PARTNER",
      pickupCodeSuffix: order.pickupCode.slice(-2),
    });
  });

  it("защищает выдачу и журнал от параллельного повтора", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);

    const results = await Promise.allSettled([
      redeemOrder(merchant.id, order.pickupCode, true),
      redeemOrder(merchant.id, order.pickupCode, true),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(prisma.pickupJournal.count({ where: { orderId: order.id } })).resolves.toBe(1);
    await expect(prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "COMPLETED" } })).resolves.toBe(1);
  });

  it("партнёр отменяет бронь с причиной, возвращает остаток и оставляет audit", async () => {
    const { merchant, customer, bag } = await createFixtures({ quantity: 2 });
    const order = await createOrder(customer.id, bag.id, 1);

    const cancelled = await cancelOrderByPartner(merchant.id, order.id, "Оборудование вышло из строя");

    expect(cancelled.status).toBe("CANCELLED_BY_PARTNER");
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ quantityLeft: 2 });
    await expect(prisma.notification.findUniqueOrThrow({ where: { dedupeKey: `order-cancelled-by-partner:${order.id}` } })).resolves.toMatchObject({ type: "ORDER_CANCELLED_BY_PARTNER", userId: customer.id });
    await expect(prisma.auditLog.findFirstOrThrow({ where: { action: "ORDER_CANCELLED_BY_PARTNER", entityId: order.id } })).resolves.toMatchObject({ actorId: merchant.id });
    const entry = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id, status: "CANCELLED_BY_PARTNER" } });
    expect(JSON.parse(entry.metadataJson)).toEqual({ reason: "Оборудование вышло из строя" });
  });

  it("не возвращает остаток дважды при параллельной отмене партнёром", async () => {
    const { merchant, customer, bag } = await createFixtures({ quantity: 2 });
    const order = await createOrder(customer.id, bag.id, 1);

    const results = await Promise.allSettled([
      cancelOrderByPartner(merchant.id, order.id, "Нет ингредиентов"),
      cancelOrderByPartner(merchant.id, order.id, "Нет ингредиентов"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ quantityLeft: 2 });
    await expect(prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "CANCELLED_BY_PARTNER" } })).resolves.toBe(1);
    await expect(prisma.notification.count({ where: { dedupeKey: `order-cancelled-by-partner:${order.id}` } })).resolves.toBe(1);
  });

  it("переводит бронь в готовую и создаёт уведомление", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);

    const ready = await markOrderReady(merchant.id, order.id);

    expect(ready.status).toBe("READY_FOR_PICKUP");
    await expect(prisma.notification.findUnique({
      where: { dedupeKey: `order-ready:${order.id}` },
    })).resolves.toMatchObject({ type: "ORDER_READY", status: "SENT" });
  });

  it("отменяет все активные брони вместе с предложением", async () => {
    const { merchant, customer, bag } = await createFixtures({ quantity: 3 });
    const secondCustomer = await prisma.user.create({
      data: { phone: "+77070007777", role: "CUSTOMER" },
    });
    await createOrder(customer.id, bag.id, 1);
    await createOrder(secondCustomer.id, bag.id, 1);

    const cancelledBag = await cancelBag(merchant.id, bag.id, "Сегодня нет возможности приготовить пакет");

    expect(cancelledBag.status).toBe("CANCELLED");
    await expect(prisma.order.count({ where: { bagId: bag.id, status: "CANCELLED_BY_PARTNER" } })).resolves.toBe(2);
  });

  it("сохраняет корректное состояние при одновременной отмене брони и предложения", async () => {
    const { merchant, customer, bag } = await createFixtures({ quantity: 2 });
    const order = await createOrder(customer.id, bag.id, 1);

    const results = await Promise.allSettled([
      cancelOrder(customer.id, order.id),
      cancelBag(merchant.id, bag.id, "Пакет повреждён"),
    ]);

    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(OrderError);
    }
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ status: "CANCELLED" });
    const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(["CANCELLED_BY_USER", "CANCELLED_BY_PARTNER"]).toContain(final.status);
  });

  it("отменяет 1000 броней и записывает аналитику пакетно", async () => {
    const { merchant, customer, bag } = await createFixtures({ quantity: 1_000 });
    await prisma.order.createMany({
      data: Array.from({ length: 1_000 }, (_, index) => ({
        bagId: bag.id,
        userId: customer.id,
        quantity: 1,
        totalPrice: bag.price,
        status: "RESERVED",
        pickupCode: `BULK${String(index).padStart(6, "0")}`,
      })),
    });

    await cancelBag(merchant.id, bag.id, "Заведение закрылось раньше");

    await expect(prisma.order.count({ where: { bagId: bag.id, status: "CANCELLED_BY_PARTNER" } })).resolves.toBe(1_000);
    await expect(prisma.productEvent.count({ where: { bagId: bag.id, name: "order_cancelled" } })).resolves.toBe(1_000);
  });
});

describe("пакетные уведомления", () => {
  it("продолжает fanout, если последний favorite предыдущей страницы удалён", async () => {
    const { venue, bag } = await createFixtures();
    const followers = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const user = await prisma.user.create({ data: {
        telegramId: `fanout-${index}`,
        role: "CUSTOMER",
        communicationsConsent: true,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        privacyAcceptedAt: new Date(),
      } });
      const favorite = await prisma.favorite.create({ data: { userId: user.id, venueId: venue.id } });
      return { user, favorite };
    }));
    const outdated = await prisma.user.create({ data: {
      telegramId: "fanout-outdated-policy",
      role: "CUSTOMER",
      communicationsConsent: true,
      privacyPolicyVersion: "outdated",
      privacyAcceptedAt: new Date(),
    } });
    await prisma.favorite.create({ data: { userId: outdated.id, venueId: venue.id } });
    await enqueueBatchJob({
      queue: "notifications",
      type: "FANOUT_NEW_BAG",
      payload: { bagId: bag.id },
      dedupeKey: `fanout-test:${bag.id}`,
    });

    await runBatchJobs("notifications", 1, 2);
    const pending = await prisma.batchJob.findUniqueOrThrow({ where: { dedupeKey: `fanout-test:${bag.id}` } });
    const cursor = (JSON.parse(pending.payloadJson) as { cursor: string }).cursor;
    await prisma.favorite.delete({ where: { id: cursor } });
    await runBatchJobs("notifications", 2, 2);

    await expect(prisma.notification.count({ where: { type: "NEW_FAVORITE_VENUE_BAG" } })).resolves.toBe(4);
    expect(followers.some(({ favorite }) => favorite.id === cursor)).toBe(true);
  });
});

describe("жизненный цикл броней", () => {
  it("разделяет активные и исторические брони клиента", async () => {
    const { customer, bag } = await createFixtures();
    const active = await createOrder(customer.id, bag.id, 1);
    await prisma.order.create({
      data: {
        bagId: bag.id,
        userId: customer.id,
        quantity: 1,
        totalPrice: bag.price,
        status: "CANCELLED_BY_USER",
        pickupCode: "HISTORY",
      },
    });

    const activeOrders = await prisma.order.findMany({
      where: customerOrderScopeWhere(customer.id, "active"),
    });
    const history = await prisma.order.findMany({
      where: customerOrderScopeWhere(customer.id, "history"),
    });

    expect(activeOrders.map(({ id }) => id)).toEqual([active.id]);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("CANCELLED_BY_USER");
  });

  it("истекает закончившиеся предложения и активные брони", async () => {
    const { customer, bag } = await createFixtures({
      pickupStart: inMinutes(-120),
      pickupEnd: inMinutes(-60),
      bagStatus: "ACTIVE",
    });
    const expiring = await prisma.order.create({
      data: {
        bagId: bag.id,
        userId: customer.id,
        quantity: 1,
        totalPrice: bag.price,
        status: "RESERVED",
        pickupCode: "EXPIRE",
      },
    });

    expect(await expireStale()).toBe(2);
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ status: "EXPIRED" });
    await expect(prisma.order.findUniqueOrThrow({ where: { pickupCode: "EXPIRE" } })).resolves.toMatchObject({ status: "NO_SHOW" });
    await expect(prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: expiring.id, status: "NO_SHOW" } })).resolves.toMatchObject({ actor: "SYSTEM", actorRole: "SYSTEM", reason: "PICKUP_WINDOW_EXPIRED" });
  });
});

describe("идемпотентность и безопасные DTO", () => {
  it("возвращает одну бронь для повторов с одним ключом", async () => {
    const pickupEnd = inMinutes(48 * 60);
    const { customer, bag } = await createFixtures({ quantity: 2, pickupEnd });
    const key = `${customer.id}:reservation-test`;
    const create = () => idempotentOrderRequest(key, `${bag.id}:1`, (recordId, ownerToken) =>
      createOrder(customer.id, bag.id, 1, recordId, ownerToken)
    );

    const concurrent = await Promise.all([create(), create(), create(), create()]);
    const first = concurrent[0];
    const second = await create();

    expect(second.id).toBe(first.id);
    expect(new Set(concurrent.map(({ id }) => id))).toEqual(new Set([first.id]));
    await expect(prisma.order.count()).resolves.toBe(1);
    await expect(prisma.orderStatusHistory.count({ where: { orderId: first.id, status: "RESERVED" } })).resolves.toBe(1);
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ quantityLeft: 1 });
    const entry = await prisma.orderIdempotencyKey.findUniqueOrThrow({ where: { key } });
    expect(entry.expiresAt.getTime()).toBeGreaterThan(pickupEnd.getTime());
  });

  it("не разрешает изменять или удалять записи журналов", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, order.pickupCode, true);
    const history = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id } });
    const pickup = await prisma.pickupJournal.findUniqueOrThrow({ where: { orderId: order.id } });

    await expect(prisma.orderStatusHistory.update({ where: { id: history.id }, data: { reason: "CHANGED" } })).rejects.toThrow("append-only");
    await expect(prisma.pickupJournal.delete({ where: { id: pickup.id } })).rejects.toThrow("append-only");
  });

  it("не раскрывает внутренние поля пользователя и брони", async () => {
    const { customer, bag } = await createFixtures();
    await prisma.user.update({ where: { id: customer.id }, data: { telegramId: "secret", sessionVersion: 7 } });
    const order = await createOrder(customer.id, bag.id, 1);
    const customerView = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: customerOrderSelect,
    });
    const merchantView = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: merchantOrderSelect,
    });

    const json = JSON.stringify({
      customer: toCustomerOrderDto(customerView),
      merchant: toMerchantOrderDto(merchantView),
    });
    expect(json).not.toContain("telegramId");
    expect(json).not.toContain("sessionVersion");
    expect(json).not.toContain("idempotencyRecordId");
    expect(json).not.toContain("payment");
    expect(JSON.parse(json)).toMatchObject({
      customer: { status: "RESERVED", totalPrice: bag.price },
      merchant: { user: { phone: customer.phone } },
    });
  });
});
