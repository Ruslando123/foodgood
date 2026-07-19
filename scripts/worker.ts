import { createServer } from "node:http";
import { prisma } from "../src/lib/db";
import { runBatchJobs } from "../src/lib/jobs";
import { expireStale } from "../src/lib/orders";
import { pruneExpiredOrderIdempotencyKeys } from "../src/modules/orders/idempotency";
import { pruneExpiredRateLimits } from "../src/shared/server/rate-limit";
import { logEvent } from "../src/lib/monitoring";
import { metricsRegistry, workerBatchSize, workerDuration, workerRuns } from "../src/lib/metrics";

type WorkerName = "expiry" | "notifications";
const name = process.argv[2] as WorkerName;
if (!["expiry", "notifications"].includes(name)) {
  throw new Error("Usage: tsx scripts/worker.ts expiry|notifications");
}

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const metricsPort = process.env.WORKER_METRICS_PORT ? Number(process.env.WORKER_METRICS_PORT) : null;
if (metricsPort !== null && (!Number.isInteger(metricsPort) || metricsPort < 1 || metricsPort > 65_535)) {
  throw new Error("WORKER_METRICS_PORT must be a valid TCP port");
}
const metricsServer = metricsPort === null ? null : createServer(async (request, response) => {
  if (request.url !== "/metrics") { response.writeHead(404).end(); return; }
  const secret = process.env.METRICS_SECRET;
  if (!secret && process.env.NODE_ENV === "production") { response.writeHead(503).end("Metrics are not configured"); return; }
  if (secret && request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(401).end(); return; }
  response.writeHead(200, { "Content-Type": metricsRegistry.contentType, "Cache-Control": "no-store" });
  response.end(await metricsRegistry.metrics());
});
metricsServer?.listen(metricsPort!);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick() {
  if (name === "expiry") {
    const expired = await expireStale(500);
    const idempotency = await pruneExpiredOrderIdempotencyKeys(500);
    const rateLimits = process.env.REDIS_URL ? 0 : await pruneExpiredRateLimits();
    return { expired, idempotency, rateLimits };
  }
  return { fanout: await runBatchJobs("notifications") };
}

async function main() {
  logEvent("info", "worker.started", { worker: name });
  do {
    const startedAt = performance.now();
    let hadWork = false;
    try {
      const result = await tick();
      hadWork = Object.values(result).some(Boolean);
      await prisma.systemState.upsert({
        where: { key: `worker:${name}` },
        update: { valueJson: JSON.stringify({ status: "ok", ...result, finishedAt: new Date().toISOString() }) },
        create: { key: `worker:${name}`, valueJson: JSON.stringify({ status: "ok", ...result, finishedAt: new Date().toISOString() }) },
      });
      workerRuns.inc({ worker: name, result: "ok" });
      workerDuration.observe({ worker: name, result: "ok" }, (performance.now() - startedAt) / 1000);
      workerBatchSize.observe({ worker: name }, Object.values(result).reduce((sum, value) => sum + value, 0));
      if (hadWork) logEvent("info", "worker.batch", { worker: name, ...result });
    } catch (error) {
      workerRuns.inc({ worker: name, result: "failed" });
      workerDuration.observe({ worker: name, result: "failed" }, (performance.now() - startedAt) / 1000);
      logEvent("error", "worker.failed", { worker: name }, error);
      await delay(5_000);
    }
    if (!process.env.WORKER_ONCE && !stopping && !hadWork) await delay(1_000);
  } while (!process.env.WORKER_ONCE && !stopping);
}

main().finally(async () => {
  metricsServer?.close();
  await prisma.$disconnect();
});
