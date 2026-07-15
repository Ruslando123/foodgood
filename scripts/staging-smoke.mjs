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

for (const path of ["/api/health/live", "/api/health/ready", "/api/health/deep"]) {
  const response = await get(path);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== "ok") throw new Error(`${path} is ${payload.status}: ${JSON.stringify(payload.checks ?? {})}`);
}

const metricsSecret = process.env.METRICS_SECRET;
if (metricsSecret) {
  const denied = await get("/api/metrics", "Bearer invalid-smoke-secret");
  if (denied.status !== 401) throw new Error(`Metrics rejected-auth check returned HTTP ${denied.status}`);
  const metrics = await get("/api/metrics", `Bearer ${metricsSecret}`);
  if (!metrics.ok || !(await metrics.text()).includes("foodgood_worker_last_heartbeat_seconds")) {
    throw new Error("Metrics endpoint is unavailable or incomplete");
  }
}

console.log("Staging smoke checks passed");
