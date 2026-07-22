import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/shared/server/api";
import { transitionBagOrders } from "@/modules/orders/state-machine";

const ACTIVE = ["OPEN", "UNDER_REVIEW", "WAITING_FOR_PARTNER", "ESCALATED"];

async function lockedComplaint(tx: Prisma.TransactionClient, complaintId: string) {
  await tx.$queryRaw`SELECT id FROM "Complaint" WHERE id = ${complaintId} FOR UPDATE`;
  const complaint = await tx.complaint.findUnique({
    where: { id: complaintId },
    include: { order: { include: { bag: true } } },
  });
  if (!complaint) throw new ApiError(404, "COMPLAINT_NOT_FOUND", "Обращение не найдено");
  return complaint;
}

function requireActive(status: string) {
  if (!ACTIVE.includes(status)) throw new ApiError(409, "COMPLAINT_NOT_ACTIVE", "Обращение уже решено или закрыто");
}

async function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  complaintId: string,
  metadata: Record<string, unknown> = {}
) {
  await tx.auditLog.create({
    data: { actorId, action, entityType: "Complaint", entityId: complaintId, metadataJson: JSON.stringify(metadata) },
  });
}

export async function recordFirstSupportContact(adminId: string, complaintId: string) {
  const contactedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const complaint = await lockedComplaint(tx, complaintId);
    requireActive(complaint.status);
    if (complaint.firstContactAt) throw new ApiError(409, "SUPPORT_CASE_CONFLICT", "Первый контакт уже отмечен");
    const nextStatus = complaint.status === "ESCALATED" ? "ESCALATED" : "UNDER_REVIEW";
    const updated = await tx.complaint.update({
      where: { id: complaintId },
      data: {
        ownerId: complaint.ownerId ?? adminId,
        firstContactAt: contactedAt,
        status: nextStatus,
        events: { create: {
          actorId: adminId,
          type: "FIRST_CONTACT",
          fromStatus: complaint.status,
          toStatus: nextStatus,
          message: "Поддержка начала рассмотрение обращения.",
        } },
      },
      include: { owner: true },
    });
    await audit(tx, adminId, "COMPLAINT_FIRST_CONTACT", complaintId, { contactedAt, ownerId: updated.ownerId });
    return updated;
  });
}

export async function markWaitingForPartner(adminId: string, complaintId: string, message: string) {
  return prisma.$transaction(async (tx) => {
    const complaint = await lockedComplaint(tx, complaintId);
    requireActive(complaint.status);
    if (!complaint.firstContactAt) throw new ApiError(409, "SUPPORT_FIRST_CONTACT_REQUIRED", "Сначала отметьте первый контакт с клиентом");
    const updated = await tx.complaint.update({
      where: { id: complaintId },
      data: {
        ownerId: complaint.ownerId ?? adminId,
        status: "WAITING_FOR_PARTNER",
        events: { create: {
          actorId: adminId,
          type: "WAITING_FOR_PARTNER",
          fromStatus: complaint.status,
          toStatus: "WAITING_FOR_PARTNER",
          message: message || "Запросили информацию у партнёра.",
        } },
      },
    });
    await audit(tx, adminId, "COMPLAINT_WAITING_FOR_PARTNER", complaintId);
    return updated;
  });
}

export async function recordPartnerResponse(adminId: string, complaintId: string, partnerResponse: string) {
  return prisma.$transaction(async (tx) => {
    const complaint = await lockedComplaint(tx, complaintId);
    requireActive(complaint.status);
    if (!complaint.firstContactAt) throw new ApiError(409, "SUPPORT_FIRST_CONTACT_REQUIRED", "Сначала отметьте первый контакт с клиентом");
    const updated = await tx.complaint.update({
      where: { id: complaintId },
      data: {
        ownerId: complaint.ownerId ?? adminId,
        partnerResponse,
        status: "UNDER_REVIEW",
        events: { create: {
          actorId: adminId,
          type: "PARTNER_RESPONSE",
          fromStatus: complaint.status,
          toStatus: "UNDER_REVIEW",
          message: partnerResponse,
        } },
      },
    });
    await audit(tx, adminId, "COMPLAINT_PARTNER_RESPONSE", complaintId, { responseLength: partnerResponse.length });
    return updated;
  });
}

export async function escalateComplaint(input: {
  adminId: string;
  complaintId: string;
  reason: string;
  suspendVenue: boolean;
  suspendOffers: boolean;
}) {
  const escalatedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const complaint = await lockedComplaint(tx, input.complaintId);
    requireActive(complaint.status);
    const foodSafety = complaint.category === "FOOD_SAFETY";
    if (!foodSafety && (input.suspendVenue || input.suspendOffers)) {
      throw new ApiError(409, "FOOD_SAFETY_REQUIRED", "Приостановка доступна только для food-safety эскалации");
    }
    const venueId = complaint.order.bag.venueId;
    let suspendedOffers = 0;
    let cancelledReservations = 0;
    const cancelledOrders: Array<{ id: string; userId: string }> = [];
    if (foodSafety && input.suspendVenue) {
      await tx.venue.update({
        where: { id: venueId },
        data: { status: "SUSPENDED", suspensionReason: `Food-safety: ${input.reason}` },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.adminId,
          action: "VENUE_SUSPENDED_FOOD_SAFETY",
          entityType: "Venue",
          entityId: venueId,
          metadataJson: JSON.stringify({ complaintId: input.complaintId, reason: input.reason }),
        },
      });
    }
    if (foodSafety && input.suspendOffers) {
      const bags = await tx.bag.findMany({ where: { venueId, status: { in: ["ACTIVE", "SOLD_OUT"] } }, select: { id: true } });
      const bagIds = bags.map((bag) => bag.id);
      if (bagIds.length) {
        suspendedOffers = (await tx.bag.updateMany({ where: { id: { in: bagIds } }, data: { status: "CANCELLED", quantityLeft: 0 } })).count;
        for (const bagId of bagIds) {
          const cancelled = await transitionBagOrders(tx, {
            bagId,
            from: ["RESERVED", "READY_FOR_PICKUP"],
            to: "CANCELLED_BY_PARTNER",
            actor: input.adminId,
            actorRole: "ADMIN",
            reason: "FOOD_SAFETY_SUSPENSION",
            metadata: { complaintId: input.complaintId, reason: input.reason },
            timestamp: escalatedAt,
          });
          cancelledReservations += cancelled.length;
          cancelledOrders.push(...cancelled.map(({ id, userId }) => ({ id, userId })));
        }
      }
      if (cancelledOrders.length) {
        await tx.notification.createMany({
          data: cancelledOrders.map((order) => ({
            userId: order.userId,
            channel: "IN_APP",
            recipient: order.userId,
            type: "ORDER_CANCELLED_BY_PARTNER",
            status: "SENT",
            sentAt: escalatedAt,
            dedupeKey: `food-safety-cancelled:${order.id}`,
            payloadJson: JSON.stringify({ orderId: order.id, reason: "Заведение временно приостановлено для проверки безопасности" }),
          })),
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: input.adminId,
          action: "OFFERS_SUSPENDED_FOOD_SAFETY",
          entityType: "Venue",
          entityId: venueId,
          metadataJson: JSON.stringify({ complaintId: input.complaintId, reason: input.reason, suspendedOffers, cancelledReservations }),
        },
      });
    }
    const updated = await tx.complaint.update({
      where: { id: input.complaintId },
      data: {
        ownerId: complaint.ownerId ?? input.adminId,
        status: "ESCALATED",
        escalatedAt,
        events: { create: {
          actorId: input.adminId,
          type: "ESCALATED",
          fromStatus: complaint.status,
          toStatus: "ESCALATED",
          message: "Обращение передано на усиленное рассмотрение.",
          metadataJson: JSON.stringify({ reason: input.reason, foodSafety, suspendVenue: input.suspendVenue, suspendOffers: input.suspendOffers }),
        } },
      },
    });
    await audit(tx, input.adminId, "COMPLAINT_ESCALATED", input.complaintId, { reason: input.reason, foodSafety, suspendedOffers, cancelledReservations });
    return updated;
  });
}

export async function resolveOrderSupportCase(input: {
  adminId: string;
  complaintId: string;
  partnerResponse: string;
  resolution: string;
  customerConfirmed: boolean;
}) {
  const resolvedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const complaint = await lockedComplaint(tx, input.complaintId);
    requireActive(complaint.status);
    if (!complaint.firstContactAt) throw new ApiError(409, "SUPPORT_FIRST_CONTACT_REQUIRED", "Сначала отметьте первый контакт с клиентом");
    const updated = await tx.complaint.update({
      where: { id: input.complaintId },
      data: {
        ownerId: complaint.ownerId ?? input.adminId,
        status: "RESOLVED",
        resolvedAt,
        partnerResponse: input.partnerResponse,
        resolution: input.resolution,
        customerConfirmed: input.customerConfirmed,
        events: { create: {
          actorId: input.adminId,
          type: "RESOLVED",
          fromStatus: complaint.status,
          toStatus: "RESOLVED",
          message: input.resolution,
          metadataJson: JSON.stringify({ customerConfirmed: input.customerConfirmed }),
        } },
      },
    });
    await audit(tx, input.adminId, "COMPLAINT_RESOLVED", input.complaintId, {
      resolvedAt,
      customerConfirmed: input.customerConfirmed,
      partnerResponseLength: input.partnerResponse.length,
      resolutionLength: input.resolution.length,
    });
    return updated;
  });
}

export async function closeComplaint(adminId: string, complaintId: string) {
  const closedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const complaint = await lockedComplaint(tx, complaintId);
    if (complaint.status !== "RESOLVED") throw new ApiError(409, "COMPLAINT_NOT_RESOLVED", "Сначала зафиксируйте решение");
    const updated = await tx.complaint.update({
      where: { id: complaintId },
      data: {
        status: "CLOSED",
        closedAt,
        events: { create: {
          actorId: adminId,
          type: "CLOSED",
          fromStatus: "RESOLVED",
          toStatus: "CLOSED",
          message: "Обращение закрыто.",
        } },
      },
    });
    await audit(tx, adminId, "COMPLAINT_CLOSED", complaintId, { closedAt });
    return updated;
  });
}
