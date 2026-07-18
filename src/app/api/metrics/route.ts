import { prisma } from "@/lib/db";
import { metricsRegistry } from "@/lib/metrics";
import { checkRedisHealth } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.METRICS_SECRET;
  if (!secret && process.env.NODE_ENV === "production") return new Response("Metrics are not configured", { status: 503 });
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const [queueRows, poolRows, heartbeatRows] = await Promise.all([
    prisma.$queryRaw<Array<{ queue: string; lag: number; depth: bigint; expiredLeases: bigint; failed: bigint }>>`
      WITH expected(queue) AS (VALUES ('notifications'))
      SELECT expected.queue,
             COALESCE(EXTRACT(EPOCH FROM (now() - MIN(job."nextAttemptAt") FILTER (
               WHERE job.status IN ('PENDING','RETRY','PROCESSING')
             ))), 0)::double precision AS lag,
             COUNT(job.id) FILTER (WHERE job.status IN ('PENDING','RETRY','PROCESSING')) AS depth,
             COUNT(job.id) FILTER (WHERE job.status = 'PROCESSING' AND job."leaseExpiresAt" < now()) AS "expiredLeases",
             COUNT(job.id) FILTER (WHERE job.status = 'FAILED') AS failed
      FROM expected
      LEFT JOIN "BatchJob" job ON job.queue = expected.queue
      GROUP BY expected.queue
    `,
    prisma.$queryRaw<Array<{ active: bigint; total: bigint; maximum: number }>>`
      SELECT COUNT(*) FILTER (WHERE state = 'active') AS active,
             COUNT(*) AS total,
             current_setting('max_connections')::integer AS maximum
      FROM pg_stat_activity WHERE datname = current_database()
    `,
    prisma.$queryRaw<Array<{ worker: string; timestamp: number }>>`
      SELECT expected.worker,
             COALESCE(EXTRACT(EPOCH FROM ((state."valueJson"::jsonb ->> 'finishedAt')::timestamptz)), 0)::double precision AS timestamp
      FROM (VALUES ('expiry'), ('notifications')) AS expected(worker)
      LEFT JOIN "SystemState" state ON state.key = 'worker:' || expected.worker
    `,
    checkRedisHealth(),
  ]);
  const base = await metricsRegistry.metrics();
  const queueMetrics = queueRows.map((row) => [
    `foodgood_queue_lag_seconds{queue="${row.queue}"} ${Math.max(0, row.lag ?? 0)}`,
    `foodgood_queue_oldest_age_seconds{queue="${row.queue}"} ${Math.max(0, row.lag ?? 0)}`,
    `foodgood_queue_depth{queue="${row.queue}"} ${row.depth}`,
    `foodgood_queue_expired_leases{queue="${row.queue}"} ${row.expiredLeases}`,
    `foodgood_queue_failed_jobs{queue="${row.queue}"} ${row.failed}`,
  ].join("\n")).join("\n");
  const pool = poolRows[0];
  const poolMetrics = pool ? `foodgood_db_pool_active ${pool.active}\nfoodgood_db_pool_connections ${pool.total}\nfoodgood_db_max_connections ${pool.maximum}` : "";
  const heartbeatMetrics = heartbeatRows.map((row) => `foodgood_worker_last_heartbeat_seconds{worker="${row.worker}"} ${row.timestamp}`).join("\n");
  return new Response(`${base}${queueMetrics}\n${poolMetrics}\n${heartbeatMetrics}\n`, {
    headers: { "Content-Type": metricsRegistry.contentType, "Cache-Control": "no-store" },
  });
}
