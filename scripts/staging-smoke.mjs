const baseUrl = (process.env.STAGING_BASE_URL ?? "").replace(/\/$/, "");
if (!baseUrl) throw new Error("STAGING_BASE_URL is required");

async function get(path, authorization) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`${baseUrl}${path}`, {
      headers: authorization ? { Authorization: authorization } : undefined,
      signal: controller.signal,
      redirect: "error",
    });
  } finally {
    clearTimeout(timeout);
  }
}

for (const path of ["/api/health/live", "/api/health/ready"]) {
  const response = await get(path);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== "ok") throw new Error(`${path} is ${payload.status}: ${JSON.stringify(payload.checks ?? {})}`);
}

const deepResponse = await get("/api/health/deep");
if (!deepResponse.ok) throw new Error(`/api/health/deep returned HTTP ${deepResponse.status}`);
const deepPayload = await deepResponse.json();
if (deepPayload.status !== "ok") {
  const allowed = new Set((process.env.STAGING_ALLOW_DEGRADED_CHECKS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
  const unhealthy = Object.entries(deepPayload.checks ?? {})
    .filter(([, value]) => !healthyCheck(value))
    .map(([name]) => name);
  const unexpected = unhealthy.filter((name) => !allowed.has(name));
  if (deepPayload.status !== "degraded" || !unhealthy.length || unexpected.length) {
    throw new Error(`/api/health/deep is ${deepPayload.status}: ${JSON.stringify(deepPayload.checks ?? {})}`);
  }
}

const metricsSecret = process.env.METRICS_SECRET;
if (!metricsSecret) throw new Error("METRICS_SECRET is required for staging smoke");
const denied = await get("/api/metrics", "Bearer invalid-smoke-secret");
if (denied.status !== 401) throw new Error(`Metrics rejected-auth check returned HTTP ${denied.status}`);
const metrics = await get("/api/metrics", `Bearer ${metricsSecret}`);
const body = metrics.ok ? await metrics.text() : "";
const requiredMetrics = [
  "foodgood_worker_last_heartbeat_seconds",
  "foodgood_queue_failed_jobs",
  "foodgood_db_pool_connections",
  "foodgood_redis_configured",
  "foodgood_redis_available",
  "foodgood_inventory_mismatch_bags",
  "foodgood_overdue_complaints",
  "foodgood_delayed_reminders",
  "foodgood_suspicious_login_challenges",
];
if (!metrics.ok || requiredMetrics.some((name) => !body.includes(name))) {
  throw new Error("Metrics endpoint is unavailable or incomplete");
}

console.log("Staging smoke checks passed");

function healthyCheck(value) {
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") return ["ok", "disabled", "not-required"].includes(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(healthyCheck);
}
