import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const globalMetrics = globalThis as unknown as {
  registry?: Registry;
  apiDuration?: Histogram<"method" | "route" | "status">;
  queryDuration?: Histogram<"model" | "operation">;
  paymentFailures?: Counter<"operation">;
  workerRuns?: Counter<"worker" | "result">;
  rateLimitFallback?: Counter;
  workerDuration?: Histogram<"worker" | "result">;
  workerBatchSize?: Histogram<"worker">;
  workerLeaseLost?: Counter<"worker">;
  workerClaims?: Counter<"worker">;
  workerSuccesses?: Counter<"worker">;
  workerFailures?: Counter<"worker">;
  workerJobDuration?: Histogram<"worker" | "result">;
};

export const metricsRegistry = globalMetrics.registry ?? new Registry();
if (!globalMetrics.registry) collectDefaultMetrics({ register: metricsRegistry, prefix: "foodgood_" });
globalMetrics.registry = metricsRegistry;

export const apiDuration = globalMetrics.apiDuration ?? new Histogram({
  name: "foodgood_http_request_duration_seconds",
  help: "Duration of API requests",
  labelNames: ["method", "route", "status"],
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

export const rateLimitFallback = globalMetrics.rateLimitFallback ?? new Counter({
  name: "foodgood_rate_limit_fallback_total",
  help: "Requests handled by the PostgreSQL rate-limit fallback",
  registers: [metricsRegistry],
});
globalMetrics.rateLimitFallback = rateLimitFallback;

export const workerDuration = globalMetrics.workerDuration ?? new Histogram({
  name: "foodgood_worker_iteration_duration_seconds",
  help: "Duration of one worker iteration",
  labelNames: ["worker", "result"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60],
  registers: [metricsRegistry],
});
globalMetrics.workerDuration = workerDuration;

export const workerBatchSize = globalMetrics.workerBatchSize ?? new Histogram({
  name: "foodgood_worker_batch_size",
  help: "Number of records handled in one worker iteration",
  labelNames: ["worker"],
  buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500],
  registers: [metricsRegistry],
});
globalMetrics.workerBatchSize = workerBatchSize;

export const workerLeaseLost = globalMetrics.workerLeaseLost ?? new Counter({
  name: "foodgood_worker_lease_lost_total",
  help: "Lease heartbeats lost before a worker could finalize an item",
  labelNames: ["worker"],
  registers: [metricsRegistry],
});
globalMetrics.workerLeaseLost = workerLeaseLost;

export const workerClaims = globalMetrics.workerClaims ?? new Counter({
  name: "foodgood_worker_claim_total",
  help: "Queue items claimed by workers",
  labelNames: ["worker"],
  registers: [metricsRegistry],
});
globalMetrics.workerClaims = workerClaims;

export const workerSuccesses = globalMetrics.workerSuccesses ?? new Counter({
  name: "foodgood_worker_success_total",
  help: "Queue items successfully finalized by workers",
  labelNames: ["worker"],
  registers: [metricsRegistry],
});
globalMetrics.workerSuccesses = workerSuccesses;

export const workerFailures = globalMetrics.workerFailures ?? new Counter({
  name: "foodgood_worker_failure_total",
  help: "Queue items returned to retry or failed by workers",
  labelNames: ["worker"],
  registers: [metricsRegistry],
});
globalMetrics.workerFailures = workerFailures;

export const workerJobDuration = globalMetrics.workerJobDuration ?? new Histogram({
  name: "foodgood_worker_job_duration_seconds",
  help: "Duration of one claimed queue item",
  labelNames: ["worker", "result"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60],
  registers: [metricsRegistry],
});
globalMetrics.workerJobDuration = workerJobDuration;
