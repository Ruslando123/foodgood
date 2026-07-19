import { prisma } from "@/lib/db";
import type { StoredComplaintAttachment } from "@/lib/complaint-attachments";
import { recordProductEvent } from "@/lib/product-analytics";
import { ApiError } from "@/shared/server/api";
import type { ComplaintCategory } from "@/shared/support";
import { isOrderStatus, transitionOrder } from "@/modules/orders/state-machine";

const ACTIVE_COMPLAINT_STATUSES = ["OPEN", "UNDER_REVIEW", "WAITING_FOR_PARTNER", "ESCALATED"];

export async function createOrderComplaint(input: {
  userId: string;
  orderId: string;
  category: ComplaintCategory;
  note: string;
  attachments?: StoredComplaintAttachment[];
}) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { bag: true },
  });
  if (!order || order.userId !== input.userId) {
    throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
  }
  const openedAt = new Date();
  return prisma.$transaction(async (tx) => {
    // Serializing on the parent order prevents two concurrent requests from
    // both observing that no active complaint exists.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    if (!isOrderStatus(current.status)) throw new ApiError(409, "INVALID_ORDER_STATUS", "Статус заказа повреждён");
    const existing = await tx.complaint.findFirst({
      where: { orderId: order.id, status: { in: ACTIVE_COMPLAINT_STATUSES } },
      select: { id: true },
    });
    if (existing) throw new ApiError(409, "COMPLAINT_ALREADY_ACTIVE", "По этому заказу уже есть активное обращение");
    if (current.status !== "DISPUTED") {
      const disputed = await transitionOrder(tx, {
        id: order.id,
        from: current.status,
        to: "DISPUTED",
        actor: input.userId,
        actorRole: "CUSTOMER",
        reason: "CUSTOMER_COMPLAINT",
        metadata: { category: input.category },
        timestamp: openedAt,
      });
      if (!disputed) throw new ApiError(409, "ORDER_CHANGED", "Статус заказа изменился, повторите действие");
    }
    const result = await tx.complaint.create({
      data: {
        orderId: order.id,
        customerId: input.userId,
        category: input.category,
        status: "OPEN",
        note: input.note,
        openedAt,
        events: {
          create: {
            actorId: input.userId,
            type: "OPENED",
            toStatus: "OPEN",
            message: input.note,
            visibleToCustomer: true,
          },
        },
        attachments: input.attachments?.length ? {
          create: input.attachments.map((attachment) => ({ uploaderId: input.userId, ...attachment })),
        } : undefined,
      },
      include: { events: true, attachments: true },
    });
    await recordProductEvent(tx, {
      name: "complaint_created",
      userId: input.userId,
      venueId: order.bag.venueId,
      bagId: order.bagId,
      orderId: order.id,
      amount: order.totalPrice,
      quantity: order.quantity,
      clientSource: order.clientSource,
      metadata: { category: input.category },
    });
    return result;
  });
}
