import { prisma } from "@/lib/db";
import { checkVenuePhotoStorage } from "@/lib/venue-photos";
import { json } from "@/shared/server/api";
import { checkRedisHealth } from "@/lib/redis";

type DeepPayload = Record<string, unknown>;
const globalHealth = globalThis as unknown as { deepHealth?: { expiresAt: number; payload: DeepPayload } };

export async function GET() {
  if (globalHealth.deepHealth && globalHealth.deepHealth.expiresAt > Date.now()) {
    return json(globalHealth.deepHealth.payload, { headers: { "X-Health-Cache": "HIT" } });
  }
  const checkedAt = new Date();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [workers, failedJobs, overdueJobs, storage, redis] = await Promise.all([
      prisma.systemState.findMany({ where: { key: { in: ["worker:expiry", "worker:notifications"] } } }),
      prisma.batchJob.count({ where: { status: "FAILED" } }),
      prisma.batchJob.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, nextAttemptAt: { lt: new Date(checkedAt.getTime() - 5 * 60_000) } } }),
      checkVenuePhotoStorage(),
      checkRedisHealth(),
    ]);
    const requiredWorkers = process.env.NODE_ENV === "production";
    const requiredWorkerNames = ["expiry", "notifications"];
    const workerHealth = Object.fromEntries(requiredWorkerNames.map((name) => {
      const heartbeat = workers.find((item) => item.key === `worker:${name}`);
      const payload = heartbeat ? safeJson(heartbeat.valueJson) : null;
      const fresh = Boolean(heartbeat && checkedAt.getTime() - heartbeat.updatedAt.getTime() < 2 * 60_000 && payload?.status === "ok");
      return [name, fresh ? "ok" : requiredWorkers ? "stale" : "not-required"];
    }));
    const workersFresh = requiredWorkerNames.every((name) => workerHealth[name] === "ok");
    const redisRequired = process.env.NODE_ENV === "production" || process.env.REDIS_REQUIRED === "true";
    const redisDegraded = redis === "unavailable" || (redisRequired && redis !== "ok");
    const degraded = !storage || redisDegraded || (requiredWorkers && !workersFresh) || failedJobs > 0 || overdueJobs > 0;
    const payload: DeepPayload = {
      status: degraded ? "degraded" : "ok",
      checkedAt: checkedAt.toISOString(),
      checks: { database: "ok", redis, storage: storage ? "ok" : "degraded", workers: workerHealth, batchJobs: { failed: failedJobs, overdue: overdueJobs } },
    };
    globalHealth.deepHealth = { expiresAt: Date.now() + 20_000, payload };
    return json(payload, { headers: { "X-Health-Cache": "MISS" } });
  } catch {
    return json({ status: "unavailable", checkedAt: checkedAt.toISOString(), checks: { database: "unavailable" } }, { status: 503 });
  }
}

function safeJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
