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
  const [queueRows, poolRows, failureRows, heartbeatRows, staleOrderRows] = await Promise.all([
    prisma.$queryRaw<Array<{ queue: string; lag: number; depth: bigint; expiredLeases: bigint }>>`
      SELECT queue,
             EXTRACT(EPOCH FROM (now() - MIN("nextAttemptAt")))::double precision AS lag,
             COUNT(*) AS depth,
             COUNT(*) FILTER (WHERE status = 'PROCESSING' AND "leaseExpiresAt" < now()) AS "expiredLeases"
      FROM (
        SELECT 'payments' AS queue, status, "nextAttemptAt", "leaseExpiresAt" FROM "PaymentOperation" WHERE status IN ('PENDING','RETRY','PROCESSING')
        UNION ALL
        SELECT 'outbox', status, "nextAttemptAt", "leaseExpiresAt" FROM "OutboxMessage" WHERE status IN ('PENDING','RETRY','PROCESSING')
        UNION ALL
        SELECT queue, status, "nextAttemptAt", "leaseExpiresAt" FROM "BatchJob" WHERE status IN ('PENDING','RETRY','PROCESSING')
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
    prisma.$queryRaw<Array<{ worker: string; timestamp: number }>>`
      SELECT expected.worker,
             COALESCE(EXTRACT(EPOCH FROM ((state."valueJson"::jsonb ->> 'finishedAt')::timestamptz)), 0)::double precision AS timestamp
      FROM (VALUES ('payments'), ('expiry'), ('notifications'), ('outbox')) AS expected(worker)
      LEFT JOIN "SystemState" state ON state.key = 'worker:' || expected.worker
    `,
    prisma.$queryRaw<Array<{ status: string; age: number }>>`
      SELECT status, EXTRACT(EPOCH FROM (now() - MIN("updatedAt")))::double precision AS age
      FROM "Order"
      WHERE status IN ('PENDING_PAYMENT', 'CAPTURE_PENDING', 'REFUND_PENDING')
      GROUP BY status
    `,
  ]);
  const base = await metricsRegistry.metrics();
  const queueMetrics = queueRows.map((row) => [
    `foodgood_queue_lag_seconds{queue="${row.queue}"} ${Math.max(0, row.lag ?? 0)}`,
    `foodgood_queue_oldest_age_seconds{queue="${row.queue}"} ${Math.max(0, row.lag ?? 0)}`,
    `foodgood_queue_depth{queue="${row.queue}"} ${row.depth}`,
    `foodgood_queue_expired_leases{queue="${row.queue}"} ${row.expiredLeases}`,
  ].join("\n")).join("\n");
  const pool = poolRows[0];
  const poolMetrics = pool
    ? `foodgood_db_pool_active ${pool.active}\nfoodgood_db_pool_connections ${pool.total}\nfoodgood_db_max_connections ${pool.maximum}`
    : "";
  const failureMetrics = `foodgood_payment_failures_recent ${failureRows[0]?.failures ?? 0}`;
  const heartbeatMetrics = heartbeatRows.map((row) => `foodgood_worker_last_heartbeat_seconds{worker="${row.worker}"} ${row.timestamp}`).join("\n");
  const staleOrderMetrics = staleOrderRows.map((row) => `foodgood_order_status_oldest_age_seconds{status="${row.status}"} ${Math.max(0, row.age ?? 0)}`).join("\n");
  return new Response(`${base}${queueMetrics}\n${poolMetrics}\n${failureMetrics}\n${heartbeatMetrics}\n${staleOrderMetrics}\n`, {
    headers: { "Content-Type": metricsRegistry.contentType, "Cache-Control": "no-store" },
  });
}
