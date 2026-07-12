import { prisma } from "../src/lib/db";
import { dispatchOutbox } from "../src/lib/outbox";
import { expireStale, reconcilePendingPayments } from "../src/lib/orders";
import { pruneExpiredRateLimits } from "../src/shared/server/rate-limit";
import { createPickupReminders } from "../src/lib/notifications";
import { logEvent, recordCronResult } from "../src/lib/monitoring";

async function main() {
  await expireStale();
  const reminders = await createPickupReminders();
  const processed = await reconcilePendingPayments();
  const dispatched = await dispatchOutbox();
  await pruneExpiredRateLimits();
  await recordCronResult("ok", { processed, dispatched, reminders, finishedAt: new Date().toISOString() });
  logEvent("info", "cron.reconcile.completed", { processed, dispatched, reminders });
}

main()
  .catch((error) => {
    logEvent("error", "cron.reconcile.failed", {}, error);
    void recordCronResult("failed", { message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() }).catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
