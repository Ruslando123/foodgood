import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { requestAccountDeletion } from "@/lib/account-deletion";
import { cancelOrder, createOrder } from "@/modules/orders";
import { createFixtures, resetDb } from "./helpers";

beforeEach(() => resetDb());

describe("безопасное удаление аккаунта", () => {
  it("деактивирует вход, отзывает коммуникации и сохраняет обязательную историю", async () => {
    const { customer, bag } = await createFixtures();
    await prisma.user.update({
      where: { id: customer.id },
      data: { communicationsConsent: true, notificationOffers: true, sessionVersion: 4 },
    });
    const order = await createOrder(customer.id, bag.id, 1);
    await cancelOrder(customer.id, order.id);

    const first = await requestAccountDeletion(customer.id, { source: "test" });
    const duplicate = await requestAccountDeletion(customer.id, { source: "duplicate" });

    expect(duplicate.id).toBe(first.id);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).resolves.toMatchObject({
      status: "DEACTIVATED",
      sessionVersion: 5,
      communicationsConsent: false,
      notificationOffers: false,
      notificationReminders: false,
      deactivatedAt: expect.any(Date),
    });
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.not.toBeNull();
    await expect(prisma.auditLog.findFirst({ where: { actorId: customer.id, action: "ACCOUNT_DELETION_REQUESTED" } })).resolves.toMatchObject({
      entityId: customer.id,
    });
    await expect(prisma.accountDeletionRequest.count({ where: { userId: customer.id, status: "PENDING" } })).resolves.toBe(1);
  });

  it("не деактивирует аккаунт с активной бронью", async () => {
    const { customer, bag } = await createFixtures();
    await createOrder(customer.id, bag.id, 1);

    await expect(requestAccountDeletion(customer.id)).rejects.toThrow("отмените или получите активные брони");
    await expect(prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(prisma.accountDeletionRequest.count({ where: { userId: customer.id } })).resolves.toBe(0);
  });
});
