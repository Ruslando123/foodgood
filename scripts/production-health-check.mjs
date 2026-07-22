const baseUrl = requiredHttpsUrl("PRODUCTION_BASE_URL");
const metricsSecret = required("METRICS_SECRET");
const workers = [
  ["expiry", requiredHttpsUrl("PRODUCTION_EXPIRY_METRICS_URL")],
  ["notifications", requiredHttpsUrl("PRODUCTION_NOTIFICATIONS_METRICS_URL")],
];

for (const path of ["/api/health/live", "/api/health/ready", "/api/health/deep"]) {
  const response = await get(`${baseUrl}${path}`);
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "ok") {
    throw new Error(`${path} gate failed: HTTP ${response.status} ${JSON.stringify(body?.checks ?? {})}`);
  }
}

await verifyProtectedMetrics(`${baseUrl}/api/metrics`, [
  "foodgood_worker_last_heartbeat_seconds",
  "foodgood_inventory_mismatch_bags",
  "foodgood_overdue_complaints",
  "foodgood_delayed_reminders",
  "foodgood_suspicious_login_challenges",
]);

for (const [worker, url] of workers) {
  const body = await verifyProtectedMetrics(url, ["foodgood_worker_runs_total"]);
  if (!body.includes(`worker=\"${worker}\"`)) throw new Error(`${worker} metrics do not identify the expected worker`);
}

console.log("Production health and metrics gates passed");

async function verifyProtectedMetrics(url, names) {
  const denied = await get(url, "Bearer invalid-production-gate-secret");
  if (denied.status !== 401) throw new Error(`${url} did not reject an invalid metrics secret`);
  const response = await get(url, `Bearer ${metricsSecret}`);
  const body = response.ok ? await response.text() : "";
  if (!response.ok || names.some((name) => !body.includes(name))) throw new Error(`${url} is unavailable or incomplete`);
  return body;
}

async function get(url, authorization) {
  return fetch(url, {
    headers: authorization ? { Authorization: authorization } : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredHttpsUrl(name) {
  const value = required(name).replace(/\/$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  return value;
}
