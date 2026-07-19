import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createOrder, redeemOrder } from "@/modules/orders";
import { createOrderComplaint } from "@/lib/order-support";
import { recordFirstSupportContact, resolveOrderSupportCase } from "@/lib/order-support-admin";
import { createFixtures, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("учёт пилотных обращений", () => {
  it("переводит завершённую выдачу в DISPUTED с атомарной историей", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, order.pickupCode, true);

    await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "POOR_QUALITY", note: "Качество не соответствует описанию" });

    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ status: "DISPUTED", supportStatus: "OPEN" });
    await expect(prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id, status: "DISPUTED" } })).resolves.toMatchObject({ actor: customer.id, actorRole: "CUSTOMER", reason: "CUSTOMER_COMPLAINT" });
  });

  it("назначает администратора при первом контакте и закрывает только с полным результатом", async () => {
    const { customer, bag } = await createFixtures();
    const admin = await prisma.user.create({ data: { phone: "+77010007777", role: "ADMIN", name: "Дежурный" } });
    const order = await createOrder(customer.id, bag.id, 1);
    await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "OTHER", note: "Нужна помощь с выдачей" });

    await expect(resolveOrderSupportCase({
      adminId: admin.id,
      orderId: order.id,
      venueResponse: "Заведение проверило выдачу",
      resolution: "Клиенту сообщили новое время",
      customerConfirmed: true,
    })).rejects.toThrow("Сначала отметьте первый контакт");

    await recordFirstSupportContact(admin.id, order.id);
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({
      supportStatus: "OPEN",
      supportOwnerId: admin.id,
      supportFirstContactAt: expect.any(Date),
    });
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { entityId: order.id, action: "ORDER_SUPPORT_CONTACTED" },
    })).resolves.toMatchObject({ actorId: admin.id });

    await resolveOrderSupportCase({
      adminId: admin.id,
      orderId: order.id,
      venueResponse: "Заведение подтвердило, что пакет подготовлен",
      resolution: "Клиент согласовал выдачу в новое окно",
      customerConfirmed: false,
    });

    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({
      supportStatus: "RESOLVED",
      supportVenueResponse: "Заведение подтвердило, что пакет подготовлен",
      supportResolution: "Клиент согласовал выдачу в новое окно",
      supportCustomerConfirmed: false,
      supportResolvedAt: expect.any(Date),
    });
    await expect(prisma.auditLog.findFirstOrThrow({
      where: { entityId: order.id, action: "ORDER_SUPPORT_RESOLVED" },
    })).resolves.toMatchObject({ actorId: admin.id });
  });

  it("не позволяет повторно отметить контакт или закрыть уже закрытое обращение", async () => {
    const { customer, bag } = await createFixtures();
    const admin = await prisma.user.create({ data: { phone: "+77010007776", role: "ADMIN" } });
    const order = await createOrder(customer.id, bag.id, 1);
    await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "ORDER_MISSING", note: "Пакет не нашли" });
    await recordFirstSupportContact(admin.id, order.id);
    await expect(recordFirstSupportContact(admin.id, order.id)).rejects.toThrow("Состояние обращения изменилось");
    await resolveOrderSupportCase({
      adminId: admin.id,
      orderId: order.id,
      venueResponse: "Заведение проверило остатки",
      resolution: "Клиенту предложили новый пакет",
      customerConfirmed: true,
    });

    await expect(recordFirstSupportContact(admin.id, order.id)).rejects.toThrow("уже закрыто");
    await expect(resolveOrderSupportCase({
      adminId: admin.id,
      orderId: order.id,
      venueResponse: "Повторный ответ заведения",
      resolution: "Повторное решение клиенту",
      customerConfirmed: true,
    })).rejects.toThrow("уже закрыто");
  });

  it("сбрасывает операционные отметки, если клиент открывает новое обращение по тому же заказу", async () => {
    const { customer, bag } = await createFixtures();
    const admin = await prisma.user.create({ data: { phone: "+77010007775", role: "ADMIN" } });
    const order = await createOrder(customer.id, bag.id, 1);
    await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "OTHER", note: "Первое обращение" });
    await recordFirstSupportContact(admin.id, order.id);
    await resolveOrderSupportCase({
      adminId: admin.id,
      orderId: order.id,
      venueResponse: "Первый ответ заведения",
      resolution: "Первое решение клиенту",
      customerConfirmed: true,
    });

    await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "OTHER", note: "Новое обращение" });

    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({
      supportStatus: "OPEN",
      supportOwnerId: null,
      supportFirstContactAt: null,
      supportVenueResponse: "",
      supportCustomerConfirmed: null,
      supportResolvedAt: null,
      supportResolution: "",
    });
  });
});
