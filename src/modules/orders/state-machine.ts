import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { recordOrderLifecycleEvent } from "@/lib/product-analytics";

export const ORDER_STATUSES = [
  "RESERVED",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED_BY_USER",
  "CANCELLED_BY_PARTNER",
  "NO_SHOW",
  "DISPUTED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderActorRole = "CUSTOMER" | "PARTNER" | "ADMIN" | "SYSTEM";

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ["RESERVED", "READY_FOR_PICKUP"];

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RESERVED: ["READY_FOR_PICKUP", "COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PARTNER", "NO_SHOW", "DISPUTED"],
  READY_FOR_PICKUP: ["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PARTNER", "NO_SHOW", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  CANCELLED_BY_USER: ["DISPUTED"],
  CANCELLED_BY_PARTNER: ["DISPUTED"],
  NO_SHOW: ["DISPUTED"],
  DISPUTED: [],
};

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

function assertAllowed(from: readonly OrderStatus[], to: OrderStatus): void {
  if (from.some((status) => !ALLOWED_TRANSITIONS[status].includes(to))) {
    throw new Error(`Недопустимый переход заказа: ${from.join("|")} -> ${to}`);
  }
}

type TransitionAudit = {
  actor: string;
  actorRole: OrderActorRole;
  reason: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
};

type TransitionInput = TransitionAudit & {
  id: string;
  from: OrderStatus | readonly OrderStatus[];
  to: OrderStatus;
  data?: Omit<Prisma.OrderUpdateManyMutationInput, "status">;
};

function lifecycleEvent(status: OrderStatus): "order_completed" | "order_cancelled" | null {
  if (status === "COMPLETED") return "order_completed";
  if (status === "CANCELLED_BY_USER" || status === "CANCELLED_BY_PARTNER") return "order_cancelled";
  return null;
}

/**
 * The only boundary for changing one order's status. The conditional update
 * and immutable history insert use the caller's transaction, so they commit or
 * roll back together. updateMany also makes concurrent repeats single-winner.
 */
export async function transitionOrder(
  tx: Prisma.TransactionClient,
  { id, from, to, data = {}, actor, actorRole, reason, metadata = {}, timestamp = new Date() }: TransitionInput
): Promise<boolean> {
  const source = Array.isArray(from) ? from : [from];
  assertAllowed(source, to);
  const changed = await tx.order.updateMany({
    where: { id, status: { in: [...source] } },
    data: { ...data, status: to },
  });
  if (changed.count !== 1) return false;

  await tx.orderStatusHistory.create({
    data: {
      id: randomUUID(),
      orderId: id,
      status: to,
      actor,
      actorRole,
      reason,
      metadataJson: JSON.stringify(metadata),
      timestamp,
    },
  });
  const eventName = lifecycleEvent(to);
  if (eventName) await recordOrderLifecycleEvent(tx, eventName, id);
  return true;
}

type BulkTransitionInput = TransitionAudit & {
  bagId: string;
  from: OrderStatus | readonly OrderStatus[];
  to: OrderStatus;
};

export type BulkTransitionedOrder = {
  id: string;
  userId: string;
  bagId: string;
  totalPrice: number;
  quantity: number;
  clientSource: string;
  venueId: string;
};

export async function transitionBagOrders(
  tx: Prisma.TransactionClient,
  { bagId, from, to, actor, actorRole, reason, metadata = {}, timestamp = new Date() }: BulkTransitionInput
): Promise<BulkTransitionedOrder[]> {
  const source = Array.isArray(from) ? from : [from];
  assertAllowed(source, to);
  const affected = await tx.$queryRaw<BulkTransitionedOrder[]>(Prisma.sql`
    UPDATE "Order" orders
    SET status = ${to}
    FROM "Bag" bag
    WHERE orders."bagId" = ${bagId}
      AND bag.id = orders."bagId"
      AND orders.status IN (${Prisma.join(source)})
    RETURNING orders.id, orders."userId", orders."bagId", orders."totalPrice",
      orders.quantity, orders."clientSource", bag."venueId"
  `);
  if (!affected.length) return affected;

  for (let offset = 0; offset < affected.length; offset += 1_000) {
    const rows = affected.slice(offset, offset + 1_000);
    await tx.orderStatusHistory.createMany({
      data: rows.map((order) => ({
        id: randomUUID(),
        orderId: order.id,
        status: to,
        actor,
        actorRole,
        reason,
        metadataJson: JSON.stringify(metadata),
        timestamp,
      })),
    });
    const eventName = lifecycleEvent(to);
    if (eventName) {
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
  return affected;
}
