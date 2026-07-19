import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createOrder, redeemOrder } from "@/modules/orders";
import { createOrderComplaint } from "@/lib/order-support";
import {
  closeComplaint,
  escalateComplaint,
  markWaitingForPartner,
  recordFirstSupportContact,
  recordPartnerResponse,
  resolveOrderSupportCase,
} from "@/lib/order-support-admin";
import { createFixtures, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("отдельные обращения и append-only история", () => {
  it("переводит завершённую выдачу в DISPUTED с атомарной историей", async () => {
    const { merchant, customer, bag } = await createFixtures();
    const order = await createOrder(customer.id, bag.id, 1);
    await redeemOrder(merchant.id, order.pickupCode, true);

    await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "POOR_QUALITY", note: "Качество не соответствует описанию" });

    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ status: "DISPUTED" });
    await expect(prisma.complaint.findFirstOrThrow({ where: { orderId: order.id } })).resolves.toMatchObject({ status: "OPEN", category: "POOR_QUALITY" });
    await expect(prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id, status: "DISPUTED" } })).resolves.toMatchObject({ actor: customer.id, actorRole: "CUSTOMER", reason: "CUSTOMER_COMPLAINT" });
  });

  it("сохраняет owner, первый контакт, ответ партнёра, решение и закрытие как события", async () => {
    const { customer, bag } = await createFixtures();
    const admin = await prisma.user.create({ data: { phone: "+77010007777", role: "ADMIN", name: "Дежурный" } });
    const order = await createOrder(customer.id, bag.id, 1);
    const complaint = await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "OTHER", note: "Нужна помощь с выдачей" });

    await expect(resolveOrderSupportCase({
      adminId: admin.id, complaintId: complaint.id, partnerResponse: "Заведение проверило выдачу",
      resolution: "Клиенту сообщили новое время", customerConfirmed: true,
    })).rejects.toThrow("Сначала отметьте первый контакт");

    await recordFirstSupportContact(admin.id, complaint.id);
    await markWaitingForPartner(admin.id, complaint.id, "Уточняем обстоятельства у партнёра.");
    await recordPartnerResponse(admin.id, complaint.id, "Заведение подтвердило, что пакет подготовлен");
    await resolveOrderSupportCase({
      adminId: admin.id, complaintId: complaint.id,
      partnerResponse: "Заведение подтвердило, что пакет подготовлен",
      resolution: "Покупатель согласовал выдачу в новое окно", customerConfirmed: false,
    });
    await closeComplaint(admin.id, complaint.id);

    await expect(prisma.complaint.findUniqueOrThrow({ where: { id: complaint.id }, include: { events: { orderBy: { createdAt: "asc" } } } })).resolves.toMatchObject({
      orderId: order.id, customerId: customer.id, ownerId: admin.id, status: "CLOSED",
      firstContactAt: expect.any(Date), partnerResponse: "Заведение подтвердило, что пакет подготовлен",
      resolution: "Покупатель согласовал выдачу в новое окно", customerConfirmed: false,
      resolvedAt: expect.any(Date), closedAt: expect.any(Date),
      events: [
        { type: "OPENED", toStatus: "OPEN" },
        { type: "FIRST_CONTACT", toStatus: "UNDER_REVIEW" },
        { type: "WAITING_FOR_PARTNER", toStatus: "WAITING_FOR_PARTNER" },
        { type: "PARTNER_RESPONSE", toStatus: "UNDER_REVIEW" },
        { type: "RESOLVED", toStatus: "RESOLVED" },
        { type: "CLOSED", toStatus: "CLOSED" },
      ],
    });
    await expect(prisma.auditLog.count({ where: { entityId: complaint.id } })).resolves.toBe(5);
  });

  it("не перезаписывает прошлый кейс при новом обращении по тому же заказу", async () => {
    const { customer, bag } = await createFixtures();
    const admin = await prisma.user.create({ data: { phone: "+77010007776", role: "ADMIN" } });
    const order = await createOrder(customer.id, bag.id, 1);
    const first = await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "ORDER_MISSING", note: "Первое обращение" });
    await expect(createOrderComplaint({ userId: customer.id, orderId: order.id, category: "OTHER", note: "Дубликат" })).rejects.toThrow("уже есть активное обращение");
    await recordFirstSupportContact(admin.id, first.id);
    await resolveOrderSupportCase({ adminId: admin.id, complaintId: first.id, partnerResponse: "Партнёр всё проверил", resolution: "Согласовано новое получение", customerConfirmed: true });
    const second = await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "OTHER", note: "Новое обращение" });

    const cases = await prisma.complaint.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({ id: first.id, status: "RESOLVED", resolution: "Согласовано новое получение" });
    expect(cases[1]).toMatchObject({ id: second.id, status: "OPEN", note: "Новое обращение", ownerId: null });
  });

  it("food-safety эскалация атомарно приостанавливает заведение и предложения с audit", async () => {
    const { customer, venue, bag } = await createFixtures();
    const admin = await prisma.user.create({ data: { phone: "+77010007775", role: "ADMIN" } });
    const order = await createOrder(customer.id, bag.id, 1);
    const complaint = await createOrderComplaint({ userId: customer.id, orderId: order.id, category: "FOOD_SAFETY", note: "Есть сомнение в безопасности продукта" });
    await recordFirstSupportContact(admin.id, complaint.id);
    await escalateComplaint({ adminId: admin.id, complaintId: complaint.id, reason: "Нужна срочная проверка хранения", suspendVenue: true, suspendOffers: true });

    await expect(prisma.venue.findUniqueOrThrow({ where: { id: venue.id } })).resolves.toMatchObject({ status: "SUSPENDED" });
    await expect(prisma.bag.findUniqueOrThrow({ where: { id: bag.id } })).resolves.toMatchObject({ status: "CANCELLED", quantityLeft: 0 });
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({ status: "DISPUTED" });
    await expect(prisma.complaint.findUniqueOrThrow({ where: { id: complaint.id } })).resolves.toMatchObject({ status: "ESCALATED", escalatedAt: expect.any(Date) });
    await expect(prisma.auditLog.findMany({ where: { action: { in: ["VENUE_SUSPENDED_FOOD_SAFETY", "OFFERS_SUSPENDED_FOOD_SAFETY", "COMPLAINT_ESCALATED"] } } })).resolves.toHaveLength(3);
  });
});
