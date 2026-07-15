import { Prisma } from "@prisma/client";

export const ORDER_STATUSES = [
  "RESERVED",
  "PENDING_PAYMENT",
  "PAID",
  "READY_FOR_PICKUP",
  "CAPTURE_PENDING",
  "COMPLETED",
  "REFUND_PENDING",
  "CANCELLED",
  "EXPIRED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RESERVED: ["READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "EXPIRED"],
  PENDING_PAYMENT: ["PAID", "REFUND_PENDING", "CANCELLED", "EXPIRED"],
  PAID: ["READY_FOR_PICKUP", "CAPTURE_PENDING", "REFUND_PENDING"],
  READY_FOR_PICKUP: ["CAPTURE_PENDING", "COMPLETED", "REFUND_PENDING", "CANCELLED", "EXPIRED"],
  CAPTURE_PENDING: ["COMPLETED"],
  COMPLETED: [],
  REFUND_PENDING: ["CANCELLED", "EXPIRED"],
  CANCELLED: ["REFUND_PENDING"],
  EXPIRED: ["REFUND_PENDING"],
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
  return changed.count === 1;
}

export async function transitionBagOrders(
  tx: Prisma.TransactionClient,
  bagId: string,
  from: OrderStatus | readonly OrderStatus[],
  to: OrderStatus,
  where: Prisma.OrderWhereInput = {}
): Promise<number> {
  const source = Array.isArray(from) ? from : [from];
  assertAllowed(source, to);
  const changed = await tx.order.updateMany({
    where: { ...where, bagId, status: { in: [...source] } },
    data: { status: to },
  });
  return changed.count;
}
