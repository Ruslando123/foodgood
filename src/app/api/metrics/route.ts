import { prisma } from "@/lib/db";
import { metricsRegistry } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.METRICS_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return new Response("Metrics are not configured", { status: 503 });
  }
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const [queueRows, poolRows, failureRows] = await Promise.all([
    prisma.$queryRaw<Array<{ queue: string; lag: number }>>`
      SELECT queue, EXTRACT(EPOCH FROM (now() - MIN("nextAttemptAt")))::double precision AS lag
      FROM (
        SELECT 'payments' AS queue, "nextAttemptAt" FROM "PaymentOperation" WHERE status IN ('PENDING','RETRY','PROCESSING')
        UNION ALL
        SELECT 'outbox', "nextAttemptAt" FROM "OutboxMessage" WHERE status IN ('PENDING','RETRY','PROCESSING')
        UNION ALL
        SELECT queue, "nextAttemptAt" FROM "BatchJob" WHERE status IN ('PENDING','RETRY','PROCESSING')
      ) queues GROUP BY queue
    `,
    prisma.$queryRaw<Array<{ active: bigint; total: bigint; maximum: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE state = 'active') AS active,
        COUNT(*) AS total,
        current_setting('max_connections')::integer AS maximum
      FROM pg_stat_activity WHERE datname = current_database()
    `,
    prisma.$queryRaw<Array<{ failures: bigint }>>`
      SELECT COUNT(*) AS failures FROM "PaymentOperation"
      WHERE "lastError" IS NOT NULL AND "updatedAt" > now() - interval '10 minutes'
    `,
  ]);
  const base = await metricsRegistry.metrics();
  const queueMetrics = queueRows.map((row) => `foodgood_queue_lag_seconds{queue="${row.queue}"} ${Math.max(0, row.lag ?? 0)}`).join("\n");
  const pool = poolRows[0];
  const poolMetrics = pool
    ? `foodgood_db_pool_active ${pool.active}\nfoodgood_db_pool_connections ${pool.total}\nfoodgood_db_max_connections ${pool.maximum}`
    : "";
  const failureMetrics = `foodgood_payment_failures_recent ${failureRows[0]?.failures ?? 0}`;
  return new Response(`${base}${queueMetrics}\n${poolMetrics}\n${failureMetrics}\n`, {
    headers: { "Content-Type": metricsRegistry.contentType, "Cache-Control": "no-store" },
  });
}
