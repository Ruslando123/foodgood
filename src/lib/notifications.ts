import { prisma } from "@/lib/db";

/**
 * Bounded deployment backfill for orders created before scheduled reminder
 * jobs existed. Normal orders create their job atomically when HOLD succeeds.
 */
export async function scheduleMissingPickupReminders(limit = 500): Promise<number> {
  const orders = await prisma.$queryRaw<Array<{ id: string; pickupStart: Date }>>`
    SELECT orders.id, bag."pickupStart"
    FROM "Order" orders
    JOIN "Bag" bag ON bag.id = orders."bagId"
    JOIN "User" account ON account.id = orders."userId"
    WHERE orders.status IN ('RESERVED', 'READY_FOR_PICKUP')
      AND bag."pickupEnd" > now()
      AND account."notificationReminders" = true
      AND NOT EXISTS (
        SELECT 1 FROM "BatchJob" job
        WHERE job."dedupeKey" = 'pickup-reminder:' || orders.id
      )
    ORDER BY bag."pickupStart", orders.id
    LIMIT ${limit}
  `;
  if (!orders.length) return 0;
  const result = await prisma.batchJob.createMany({
    data: orders.map((order) => ({
      queue: "notifications",
      type: "PICKUP_REMINDER",
      dedupeKey: `pickup-reminder:${order.id}`,
      payloadJson: JSON.stringify({ orderId: order.id }),
      nextAttemptAt: new Date(order.pickupStart.getTime() - 60 * 60_000),
    })),
    skipDuplicates: true,
  });
  return result.count;
}
