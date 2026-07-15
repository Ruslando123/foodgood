import { prisma } from "../src/lib/db";
import { runBatchJobs } from "../src/lib/jobs";
import { dispatchOutbox } from "../src/lib/outbox";
import { expireStale, reconcilePendingPayments, reconcileSettledPayments } from "../src/lib/orders";
import { pruneExpiredOrderIdempotencyKeys } from "../src/modules/orders/idempotency";
import { pruneExpiredRateLimits } from "../src/shared/server/rate-limit";
import { logEvent } from "../src/lib/monitoring";
import { workerRuns } from "../src/lib/metrics";
import { metricsRegistry, workerBatchSize, workerDuration } from "../src/lib/metrics";
import { createServer } from "node:http";
import { flushMockPaymentFaultStats } from "../src/lib/mock-payment-fault";

type WorkerName = "payments" | "expiry" | "notifications" | "outbox";
const name = process.argv[2] as WorkerName;
if (!["payments", "expiry", "notifications", "outbox"].includes(name)) {
  throw new Error("Usage: tsx scripts/worker.ts payments|expiry|notifications|outbox");
}

let stopping = false;
let lastSettlementReconciliationAt = 0;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const metricsPort = process.env.WORKER_METRICS_PORT ? Number(process.env.WORKER_METRICS_PORT) : null;
if (metricsPort !== null && (!Number.isInteger(metricsPort) || metricsPort < 1 || metricsPort > 65_535)) {
  throw new Error("WORKER_METRICS_PORT must be a valid TCP port");
}
const metricsServer = metricsPort === null ? null : createServer(async (request, response) => {
  if (request.url !== "/metrics") { response.writeHead(404).end(); return; }
  const secret = process.env.METRICS_SECRET;
  if (secret && request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(401).end(); return; }
  response.writeHead(200, { "Content-Type": metricsRegistry.contentType, "Cache-Control": "no-store" });
  response.end(await metricsRegistry.metrics());
});
metricsServer?.listen(metricsPort!);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick() {
  if (name === "payments") {
    const refunds = await runBatchJobs("refunds");
    const payments = await reconcilePendingPayments(100);
    let reconciliationChecked = 0;
    let reconciliationMismatches = 0;
    if (Date.now() - lastSettlementReconciliationAt >= 15 * 60_000) {
      const reconciliation = await reconcileSettledPayments(50);
      reconciliationChecked = reconciliation.checked;
      reconciliationMismatches = reconciliation.mismatches;
      lastSettlementReconciliationAt = Date.now();
    }
    return { refunds, payments, reconciliationChecked, reconciliationMismatches };
  }
  if (name === "expiry") {
    const expired = await expireStale(500);
    const idempotency = await pruneExpiredOrderIdempotencyKeys(500);
    const rateLimits = process.env.REDIS_URL ? 0 : await pruneExpiredRateLimits().then(() => 1);
    return { expired, idempotency, rateLimits };
  }
  if (name === "notifications") {
    const fanout = await runBatchJobs("notifications");
    return { fanout };
  }
  return { dispatched: await dispatchOutbox(100) };
}

async function main() {
  logEvent("info", "worker.started", { worker: name });
  do {
    const startedAt = performance.now();
    try {
      const result = await tick();
      await prisma.systemState.upsert({
        where: { key: `worker:${name}` },
        update: { valueJson: JSON.stringify({ status: "ok", ...result, finishedAt: new Date().toISOString() }) },
        create: { key: `worker:${name}`, valueJson: JSON.stringify({ status: "ok", ...result, finishedAt: new Date().toISOString() }) },
      });
      workerRuns.inc({ worker: name, result: "ok" });
      workerDuration.observe({ worker: name, result: "ok" }, (performance.now() - startedAt) / 1000);
      workerBatchSize.observe({ worker: name }, Object.values(result).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0));
      if (Object.values(result).some(Boolean)) logEvent("info", "worker.batch", { worker: name, ...result });
    } catch (error) {
      workerRuns.inc({ worker: name, result: "failed" });
      workerDuration.observe({ worker: name, result: "failed" }, (performance.now() - startedAt) / 1000);
      logEvent("error", "worker.failed", { worker: name }, error);
      await delay(5_000);
    }
    if (name === "payments") {
      try {
        await flushMockPaymentFaultStats();
      } catch (error) {
        logEvent("error", "worker.fault_stats_flush_failed", { worker: name }, error);
      }
    }
    if (!process.env.WORKER_ONCE && !stopping) await delay(1_000);
  } while (!process.env.WORKER_ONCE && !stopping);
}

main().finally(async () => {
  metricsServer?.close();
  try {
    if (name === "payments") await flushMockPaymentFaultStats(true);
  } finally {
    await prisma.$disconnect();
  }
});
