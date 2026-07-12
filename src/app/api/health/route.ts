import { prisma } from "@/lib/db";
import { checkVenuePhotoStorage } from "@/lib/venue-photos";
import { json } from "@/shared/server/api";

export async function GET() {
  const checkedAt = new Date();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [workers, paymentNeedsReview, overduePayments, failedOutbox, overdueOutbox, failedJobs, overdueJobs, storage] = await Promise.all([
      prisma.systemState.findMany({ where: { key: { in: ["worker:payments", "worker:expiry", "worker:notifications", "worker:outbox"] } } }),
      prisma.paymentOperation.count({ where: { status: "NEEDS_REVIEW" } }),
      prisma.paymentOperation.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, nextAttemptAt: { lt: new Date(checkedAt.getTime() - 5 * 60_000) } } }),
      prisma.outboxMessage.count({ where: { status: "FAILED" } }),
      prisma.outboxMessage.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, nextAttemptAt: { lt: new Date(checkedAt.getTime() - 5 * 60_000) } } }),
      prisma.batchJob.count({ where: { status: "FAILED" } }),
      prisma.batchJob.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, nextAttemptAt: { lt: new Date(checkedAt.getTime() - 5 * 60_000) } } }),
      checkVenuePhotoStorage(),
    ]);
    const requiredWorkers = process.env.NODE_ENV === "production";
    const workerHealth = Object.fromEntries(["payments", "expiry", "notifications", "outbox"].map((name) => {
      const heartbeat = workers.find((item) => item.key === `worker:${name}`);
      const payload = heartbeat ? safeJson(heartbeat.valueJson) : null;
      const fresh = Boolean(heartbeat && checkedAt.getTime() - heartbeat.updatedAt.getTime() < 2 * 60_000 && payload?.status === "ok");
      return [name, fresh ? "ok" : requiredWorkers ? "stale" : "not-required"];
    }));
    const workersFresh = Object.values(workerHealth).every((status) => status === "ok");
    const unavailable = !storage;
    const degraded = (requiredWorkers && !workersFresh) || paymentNeedsReview > 0 || overduePayments > 0 || failedOutbox > 0 || overdueOutbox > 0 || failedJobs > 0 || overdueJobs > 0;
    return json({
      status: unavailable ? "unavailable" : degraded ? "degraded" : "ok",
      checkedAt: checkedAt.toISOString(),
      checks: {
        database: "ok",
        storage: storage ? "ok" : "unavailable",
        workers: workerHealth,
        payments: { needsReview: paymentNeedsReview, overdue: overduePayments },
        notifications: { failed: failedOutbox, overdue: overdueOutbox },
        batchJobs: { failed: failedJobs, overdue: overdueJobs },
      },
    }, { status: unavailable ? 503 : 200 });
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
