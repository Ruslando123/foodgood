import { prisma } from "../src/lib/db";
import { runBatchJobs } from "../src/lib/jobs";
import { createPickupReminders } from "../src/lib/notifications";
import { dispatchOutbox } from "../src/lib/outbox";
import { expireStale, reconcilePendingPayments } from "../src/lib/orders";
import { pruneExpiredOrderIdempotencyKeys } from "../src/modules/orders/idempotency";
import { pruneExpiredRateLimits } from "../src/shared/server/rate-limit";
import { logEvent } from "../src/lib/monitoring";
import { workerRuns } from "../src/lib/metrics";

type WorkerName = "payments" | "expiry" | "notifications" | "outbox";
const name = process.argv[2] as WorkerName;
if (!["payments", "expiry", "notifications", "outbox"].includes(name)) {
  throw new Error("Usage: tsx scripts/worker.ts payments|expiry|notifications|outbox");
}

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick() {
  if (name === "payments") {
    const refunds = await runBatchJobs("refunds");
    const payments = await reconcilePendingPayments(100);
    return { refunds, payments };
  }
  if (name === "expiry") {
    const expired = await expireStale(500);
    const idempotency = await pruneExpiredOrderIdempotencyKeys(500);
    const rateLimits = process.env.REDIS_URL ? 0 : await pruneExpiredRateLimits().then(() => 1);
    return { expired, idempotency, rateLimits };
  }
  if (name === "notifications") {
    const fanout = await runBatchJobs("notifications");
    const reminders = await createPickupReminders();
    return { fanout, reminders };
  }
  return { dispatched: await dispatchOutbox(100) };
}

async function main() {
  logEvent("info", "worker.started", { worker: name });
  do {
    try {
      const result = await tick();
      await prisma.systemState.upsert({
        where: { key: `worker:${name}` },
        update: { valueJson: JSON.stringify({ status: "ok", ...result, finishedAt: new Date().toISOString() }) },
        create: { key: `worker:${name}`, valueJson: JSON.stringify({ status: "ok", ...result, finishedAt: new Date().toISOString() }) },
      });
      workerRuns.inc({ worker: name, result: "ok" });
      if (Object.values(result).some(Boolean)) logEvent("info", "worker.batch", { worker: name, ...result });
    } catch (error) {
      workerRuns.inc({ worker: name, result: "failed" });
      logEvent("error", "worker.failed", { worker: name }, error);
      await delay(5_000);
    }
    if (!process.env.WORKER_ONCE && !stopping) await delay(1_000);
  } while (!process.env.WORKER_ONCE && !stopping);
}

main().finally(() => prisma.$disconnect());
