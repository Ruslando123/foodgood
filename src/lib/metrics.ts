import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const globalMetrics = globalThis as unknown as {
  registry?: Registry;
  apiDuration?: Histogram<"status">;
  queryDuration?: Histogram<"model" | "operation">;
  paymentFailures?: Counter<"operation">;
  workerRuns?: Counter<"worker" | "result">;
};

export const metricsRegistry = globalMetrics.registry ?? new Registry();
if (!globalMetrics.registry) collectDefaultMetrics({ register: metricsRegistry, prefix: "foodgood_" });
globalMetrics.registry = metricsRegistry;

export const apiDuration = globalMetrics.apiDuration ?? new Histogram({
  name: "foodgood_http_request_duration_seconds",
  help: "Duration of API requests",
  labelNames: ["status"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});
globalMetrics.apiDuration = apiDuration;

export const queryDuration = globalMetrics.queryDuration ?? new Histogram({
  name: "foodgood_prisma_query_duration_seconds",
  help: "Duration of Prisma queries",
  labelNames: ["model", "operation"],
  buckets: [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3],
  registers: [metricsRegistry],
});
globalMetrics.queryDuration = queryDuration;

export const paymentFailures = globalMetrics.paymentFailures ?? new Counter({
  name: "foodgood_payment_failures_total",
  help: "Failed payment provider operations",
  labelNames: ["operation"],
  registers: [metricsRegistry],
});
globalMetrics.paymentFailures = paymentFailures;

export const workerRuns = globalMetrics.workerRuns ?? new Counter({
  name: "foodgood_worker_runs_total",
  help: "Worker iterations by result",
  labelNames: ["worker", "result"],
  registers: [metricsRegistry],
});
globalMetrics.workerRuns = workerRuns;
