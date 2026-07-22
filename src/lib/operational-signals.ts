import { prisma } from "./db";

export type OperationalSignals = {
  inventoryMismatchBags: number;
  overdueComplaints: number;
  delayedReminders: number;
  suspiciousLoginChallenges: number;
};

/**
 * Low-cardinality pilot signals derived from durable PostgreSQL state.
 * No customer, phone, venue, or order identifiers are exposed as metric labels.
 */
export async function readOperationalSignals(): Promise<OperationalSignals> {
  const [row] = await prisma.$queryRaw<Array<{
    inventoryMismatchBags: bigint;
    overdueComplaints: bigint;
    delayedReminders: bigint;
    suspiciousLoginChallenges: bigint;
  }>>`
    WITH order_totals AS (
      SELECT "bagId",
             COALESCE(SUM(quantity) FILTER (
               WHERE status IN ('RESERVED', 'READY_FOR_PICKUP', 'COMPLETED')
             ), 0)::bigint AS committed
      FROM "Order"
      GROUP BY "bagId"
    )
    SELECT
      (
        SELECT COUNT(*)
        FROM "Bag" bag
        LEFT JOIN order_totals totals ON totals."bagId" = bag.id
        WHERE bag."quantityLeft" < 0
           OR bag."quantityLeft" > bag."quantityTotal"
           OR bag."quantityLeft" + COALESCE(totals.committed, 0) > bag."quantityTotal"
           OR (bag.status = 'ACTIVE' AND bag."quantityLeft" = 0)
           OR (bag.status = 'SOLD_OUT' AND bag."quantityLeft" <> 0)
      )::bigint AS "inventoryMismatchBags",
      (
        SELECT COUNT(*) FROM "Complaint"
        WHERE status IN ('OPEN', 'UNDER_REVIEW', 'WAITING_FOR_PARTNER', 'ESCALATED')
          AND "firstContactAt" IS NULL
          AND "openedAt" < now() - interval '2 hours'
      )::bigint AS "overdueComplaints",
      (
        SELECT COUNT(*) FROM "BatchJob"
        WHERE type = 'PICKUP_REMINDER'
          AND status IN ('PENDING', 'RETRY', 'PROCESSING')
          AND "nextAttemptAt" < now() - interval '5 minutes'
      )::bigint AS "delayedReminders",
      (
        SELECT COUNT(*) FROM "OtpChallenge"
        WHERE "createdAt" >= now() - interval '15 minutes'
          AND attempts >= 3
      )::bigint AS "suspiciousLoginChallenges"
  `;
  return {
    inventoryMismatchBags: Number(row?.inventoryMismatchBags ?? 0),
    overdueComplaints: Number(row?.overdueComplaints ?? 0),
    delayedReminders: Number(row?.delayedReminders ?? 0),
    suspiciousLoginChallenges: Number(row?.suspiciousLoginChallenges ?? 0),
  };
}
