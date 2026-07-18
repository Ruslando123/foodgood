import { Prisma } from "@prisma/client";
import { recordOrderLifecycleEvent } from "@/lib/product-analytics";

export const ORDER_STATUSES = [
  "RESERVED",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RESERVED: ["READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "EXPIRED"],
  READY_FOR_PICKUP: ["COMPLETED", "CANCELLED", "EXPIRED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

function assertAllowed(from: readonly OrderStatus[], to: OrderStatus): void {
  if (from.some((status) => !ALLOWED_TRANSITIONS[status].includes(to))) {
    throw new Error(`Недопустимый переход заказа: ${from.join("|")} -> ${to}`);
  }
}

type TransitionInput = {
  id: string;
  from: OrderStatus | readonly OrderStatus[];
  to: OrderStatus;
  data?: Omit<Prisma.OrderUpdateManyMutationInput, "status">;
};

/**
 * Единственная граница изменения статуса заказа. Условный updateMany повторно
 * проверяет исходный статус после получения row lock, поэтому параллельный
 * переход может выиграть только один раз.
 */
export async function transitionOrder(
  tx: Prisma.TransactionClient,
  { id, from, to, data = {} }: TransitionInput
): Promise<boolean> {
  const source = Array.isArray(from) ? from : [from];
  assertAllowed(source, to);
  const changed = await tx.order.updateMany({
    where: { id, status: { in: [...source] } },
    data: { ...data, status: to },
  });
  if (changed.count === 1 && (to === "COMPLETED" || to === "CANCELLED")) {
    await recordOrderLifecycleEvent(tx, to === "COMPLETED" ? "order_completed" : "order_cancelled", id);
  }
  return changed.count === 1;
}

export async function transitionBagOrders(
  tx: Prisma.TransactionClient,
  bagId: string,
  from: OrderStatus | readonly OrderStatus[],
  to: OrderStatus
): Promise<number> {
  const source = Array.isArray(from) ? from : [from];
  assertAllowed(source, to);
  const affected = await tx.$queryRaw<Array<{
    id: string;
    userId: string;
    bagId: string;
    totalPrice: number;
    quantity: number;
    clientSource: string;
    venueId: string;
  }>>(Prisma.sql`
    UPDATE "Order" orders
    SET status = ${to}
    FROM "Bag" bag
    WHERE orders."bagId" = ${bagId}
      AND bag.id = orders."bagId"
      AND orders.status IN (${Prisma.join(source)})
    RETURNING orders.id, orders."userId", orders."bagId", orders."totalPrice",
      orders.quantity, orders."clientSource", bag."venueId"
  `);
  if (affected.length && (to === "COMPLETED" || to === "CANCELLED")) {
    const eventName = to === "COMPLETED" ? "order_completed" : "order_cancelled";
    // A bag may contain thousands of reservations. Insert analytics in
    // bounded multi-row statements instead of issuing two queries per order.
    for (let offset = 0; offset < affected.length; offset += 1_000) {
      const rows = affected.slice(offset, offset + 1_000);
      await tx.productEvent.createMany({
        data: rows.map((order) => ({
          name: eventName,
          userId: order.userId,
          venueId: order.venueId,
          bagId: order.bagId,
          orderId: order.id,
          amount: order.totalPrice,
          quantity: order.quantity,
          clientSource: order.clientSource,
          dedupeKey: `${eventName}:${order.id}`,
        })),
        skipDuplicates: true,
      });
    }
  }
  return affected.length;
}
