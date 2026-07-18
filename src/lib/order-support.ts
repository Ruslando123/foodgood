import { prisma } from "@/lib/db";
import { recordProductEvent } from "@/lib/product-analytics";
import { ApiError } from "@/shared/server/api";
import type { ComplaintCategory } from "@/shared/support";

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

  const openedAt = new Date();
  return prisma.$transaction(async (tx) => {
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
