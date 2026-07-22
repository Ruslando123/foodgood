import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/shared/server/api";

export const ACCOUNT_DELETION_CONFIRMATION = "УДАЛИТЬ АККАУНТ";

export async function requestAccountDeletion(userId: string, metadata: Record<string, unknown> = {}) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const existing = await tx.accountDeletionRequest.findFirst({ where: { userId, status: "PENDING" } });
      if (existing) return existing;
      const activeOrders = await tx.order.count({
        where: { userId, status: { in: ["RESERVED", "READY_FOR_PICKUP"] }, bag: { pickupEnd: { gt: new Date() } } },
      });
      if (activeOrders > 0) {
        throw new ApiError(409, "ACTIVE_ORDERS_EXIST", "Перед удалением аккаунта отмените или получите активные брони");
      }
      const created = await tx.accountDeletionRequest.create({
        data: {
          userId,
          retentionReason: "История броней, обращений и аудит сохраняются на обязательный срок; затем данные минимизируются.",
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          status: "DEACTIVATED",
          deactivatedAt: new Date(),
          communicationsConsent: false,
          communicationsConsentUpdatedAt: new Date(),
          notificationOffers: false,
          notificationReminders: false,
          sessionVersion: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "ACCOUNT_DELETION_REQUESTED",
          entityType: "User",
          entityId: userId,
          metadataJson: JSON.stringify({ requestId: created.id, historyRetained: true, ...metadata }),
        },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId, status: "PENDING" } });
    }
    throw error;
  }
}
