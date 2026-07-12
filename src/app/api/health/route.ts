import { prisma } from "@/lib/db";
import { checkVenuePhotoStorage } from "@/lib/venue-photos";
import { json } from "@/shared/server/api";

export async function GET() {
  const checkedAt = new Date();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [cron, paymentNeedsReview, overduePayments, failedOutbox, overdueOutbox, storage] = await Promise.all([
      prisma.systemState.findUnique({ where: { key: "cron:reconcile" } }),
      prisma.paymentOperation.count({ where: { status: "NEEDS_REVIEW" } }),
      prisma.paymentOperation.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, nextAttemptAt: { lt: new Date(checkedAt.getTime() - 5 * 60_000) } } }),
      prisma.outboxMessage.count({ where: { status: "FAILED" } }),
      prisma.outboxMessage.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, nextAttemptAt: { lt: new Date(checkedAt.getTime() - 5 * 60_000) } } }),
      checkVenuePhotoStorage(),
    ]);
    const cronPayload = cron ? safeJson(cron.valueJson) : null;
    const cronFresh = Boolean(cron && checkedAt.getTime() - cron.updatedAt.getTime() < 5 * 60_000 && cronPayload?.status === "ok");
    const cronRequired = process.env.NODE_ENV === "production";
    // Readiness must not deadlock a fresh deployment before its first cron run.
    // Cron staleness is therefore observable as degraded, while DB/storage failures return 503.
    const unavailable = !storage;
    const degraded = (cronRequired && !cronFresh) || paymentNeedsReview > 0 || overduePayments > 0 || failedOutbox > 0 || overdueOutbox > 0;
    return json({
      status: unavailable ? "unavailable" : degraded ? "degraded" : "ok",
      checkedAt: checkedAt.toISOString(),
      checks: {
        database: "ok",
        storage: storage ? "ok" : "unavailable",
        cron: cronFresh ? "ok" : cronRequired ? "stale" : "not-required",
        payments: { needsReview: paymentNeedsReview, overdue: overduePayments },
        notifications: { failed: failedOutbox, overdue: overdueOutbox },
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
