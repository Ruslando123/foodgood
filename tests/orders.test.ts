import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  createOrder,
  cancelOrder,
  redeemOrder,
  expireStale,
  cancelBagWithRefunds,
  OrderError,
} from "@/lib/orders";
import { PLATFORM_FEE_PCT } from "@/lib/config";
import { resetDb, createFixtures, inMinutes } from "./helpers";

beforeEach(resetDb);

describe("createOrder", () => {
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

  it("серия покупок не уводит остаток в минус", async () => {
    const { customer, bag } = await createFixtures({ quantity: 3 });

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        await createOrder(customer.id, bag.id, 1).then(
          () => "ok",
          () => "rejected"
        )
      );
    }

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
    await expireStale(); // повторный вызов не должен ломаться и дублировать refund

    const payments = await prisma.payment.findMany();
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("REFUNDED");
  });
});
