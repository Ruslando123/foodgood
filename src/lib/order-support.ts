import { prisma } from "@/lib/db";
import { recordProductEvent } from "@/lib/product-analytics";
import { ApiError } from "@/shared/server/api";
import type { ComplaintCategory } from "@/shared/support";
import { isOrderStatus, transitionOrder } from "@/modules/orders/state-machine";

export async function createOrderComplaint(input: {
  userId: string;
  orderId: string;
  category: ComplaintCategory;
  note: string;
}) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { bag: true },
  });
  if (!order || order.userId !== input.userId) {
    throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    if (!isOrderStatus(current.status)) throw new ApiError(409, "INVALID_ORDER_STATUS", "Статус заказа повреждён");
    const openedAt = new Date();
    if (!["RESERVED", "READY_FOR_PICKUP", "DISPUTED"].includes(current.status)) {
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
    const result = await tx.order.update({
      where: { id: order.id },
      data: {
        supportStatus: "OPEN",
        supportCategory: input.category,
        supportNote: input.note,
        supportOpenedAt: openedAt,
        supportOwnerId: null,
        supportFirstContactAt: null,
        supportVenueResponse: "",
        supportCustomerConfirmed: null,
        supportResolvedAt: null,
        supportResolution: "",
      },
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
