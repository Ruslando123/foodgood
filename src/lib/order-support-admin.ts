import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/shared/server/api";

async function supportCaseFailure(tx: Prisma.TransactionClient, orderId: string): Promise<never> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { supportStatus: true, supportFirstContactAt: true },
  });
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
  if (order.supportStatus !== "OPEN") {
    throw new ApiError(409, "SUPPORT_CASE_NOT_OPEN", "Обращение уже закрыто");
  }
  if (!order.supportFirstContactAt) {
    throw new ApiError(409, "SUPPORT_FIRST_CONTACT_REQUIRED", "Сначала отметьте первый контакт с клиентом");
  }
  throw new ApiError(409, "SUPPORT_CASE_CONFLICT", "Состояние обращения изменилось, обновите страницу");
}

export async function recordFirstSupportContact(adminId: string, orderId: string) {
  const contactedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, supportStatus: "OPEN", supportFirstContactAt: null },
      data: { supportOwnerId: adminId, supportFirstContactAt: contactedAt },
    });
    if (!updated.count) return supportCaseFailure(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: "ORDER_SUPPORT_CONTACTED",
        entityType: "Order",
        entityId: orderId,
        metadataJson: JSON.stringify({ contactedAt }),
      },
    });
    return order;
  });
}

export async function resolveOrderSupportCase(input: {
  adminId: string;
  orderId: string;
  venueResponse: string;
  resolution: string;
  customerConfirmed: boolean;
}) {
  const resolvedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: {
        id: input.orderId,
        supportStatus: "OPEN",
        supportFirstContactAt: { not: null },
      },
      data: {
        supportStatus: "RESOLVED",
        supportResolvedAt: resolvedAt,
        supportVenueResponse: input.venueResponse,
        supportResolution: input.resolution,
        supportCustomerConfirmed: input.customerConfirmed,
      },
    });
    if (!updated.count) return supportCaseFailure(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "ORDER_SUPPORT_RESOLVED",
        entityType: "Order",
        entityId: input.orderId,
        metadataJson: JSON.stringify({
          resolvedAt,
          customerConfirmed: input.customerConfirmed,
          venueResponseLength: input.venueResponse.length,
          resolutionLength: input.resolution.length,
        }),
      },
    });
    return order;
  });
}
