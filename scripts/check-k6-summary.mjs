import { readFile } from "node:fs/promises";

const summaryFile = process.env.K6_SUMMARY_FILE;
if (!summaryFile) throw new Error("K6_SUMMARY_FILE is required (use k6 --summary-export)");

const summary = JSON.parse(await readFile(summaryFile, "utf8"));
const metrics = summary.metrics ?? {};
const gates = {
  p95Ms: maximum("K6_MAX_P95_MS", 500),
  p99Ms: maximum("K6_MAX_P99_MS", 1200),
  failureRate: rate("K6_MAX_FAILURE_RATE", 0.005),
  minimumCheckRate: rate("K6_MIN_CHECK_RATE", 0.995),
};
const observed = {
  p95Ms: metric("http_req_duration", "p(95)"),
  p99Ms: metric("http_req_duration", "p(99)"),
  failureRate: metric("http_req_failed", "rate"),
  checkRate: metric("checks", "rate"),
  droppedIterations: metric("dropped_iterations", "count", 0),
  thresholds: thresholdResults(),
};

const failures = [];
if (observed.p95Ms > gates.p95Ms) failures.push(`p95 ${observed.p95Ms}ms > ${gates.p95Ms}ms`);
if (observed.p99Ms > gates.p99Ms) failures.push(`p99 ${observed.p99Ms}ms > ${gates.p99Ms}ms`);
if (observed.failureRate >= gates.failureRate) failures.push(`failure rate ${observed.failureRate} >= ${gates.failureRate}`);
if (observed.checkRate <= gates.minimumCheckRate) failures.push(`check rate ${observed.checkRate} <= ${gates.minimumCheckRate}`);
if (observed.droppedIterations !== 0) failures.push(`dropped iterations ${observed.droppedIterations} != 0`);
if (!observed.thresholds.total) failures.push("summary contains no profile-specific threshold results");
for (const threshold of observed.thresholds.failed) failures.push(`threshold failed: ${threshold}`);

console.log(JSON.stringify({ summaryFile, gates, observed, status: failures.length ? "failed" : "passed" }, null, 2));
if (failures.length) throw new Error(`k6 release gate failed: ${failures.join("; ")}`);

function metric(name, key, fallback) {
  const entry = metrics[name];
  const value = entry?.values?.[key] ?? entry?.[key] ?? (
    key === "rate" ? entry?.value : undefined
  );
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`k6 summary is missing numeric metrics.${name}[${JSON.stringify(key)}]`);
  }
  return value;
}

function thresholdResults() {
  const failed = [];
  let total = 0;
  for (const [metricName, entry] of Object.entries(metrics)) {
    for (const [expression, result] of Object.entries(entry?.thresholds ?? {})) {
      total += 1;
      // k6 JSON summary uses true for a crossed threshold; some exporters use { ok }.
      const crossed = typeof result === "boolean" ? result : result?.ok !== true;
      if (crossed) failed.push(`${metricName}: ${expression}`);
    }
  }
  return { total, failed };
}

function maximum(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function rate(name, fallback) {
  const value = maximum(name, fallback);
  if (value > 1) throw new Error(`${name} must not exceed 1`);
  return value;
}
