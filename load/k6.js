import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "";
const CONTROL_SECRET = __ENV.LOAD_TEST_CONTROL_SECRET || "";
const fixtures = JSON.parse(open(__ENV.LOAD_FIXTURE_FILE || "./fixtures.local.json"));

const businessFailures = new Rate("business_failures");
const oversell = new Counter("oversell_detected");
const lastBagCreated = new Counter("last_bag_orders_created");
const providerOrdersCreated = new Counter("provider_orders_created");
const redeemSuccess = new Counter("redeem_success");
const providerFaultEnabled = new Counter("provider_fault_enabled");
const providerFaultApplied = new Counter("provider_fault_applied");
const providerLatency = new Trend("provider_degradation_latency", true);
const catalogLatency = new Trend("catalog_latency", true);
const orderLatency = new Trend("order_latency", true);
const redeemLatency = new Trend("redeem_latency", true);
const apiLatency = new Trend("other_api_latency", true);

const status200 = http.expectedStatuses(200);
const orderRaceStatuses = http.expectedStatuses(201, 409);
const orderCreatedStatus = http.expectedStatuses(201);
const redeemStatuses = http.expectedStatuses(200, 409);

export const options = {
  scenarios: {
    catalog: {
      executor: "ramping-arrival-rate", exec: "browseCatalog", startRate: 5, timeUnit: "1s",
      stages: [
        { duration: __ENV.WARMUP_DURATION || "5m", target: 15 },
        { duration: __ENV.PEAK_DURATION || "15m", target: 40 },
        { duration: __ENV.SPIKE_DURATION || "7m", target: 80 },
        { duration: __ENV.SOAK_DURATION || "30m", target: 25 },
      ],
      preAllocatedVUs: 50, maxVUs: 200,
    },
    order_history: {
      executor: "ramping-arrival-rate", exec: "readOrderHistory", startRate: 1, timeUnit: "1s",
      stages: [
        { duration: __ENV.WARMUP_DURATION || "5m", target: 3 },
        { duration: __ENV.PEAK_DURATION || "15m", target: 8 },
        { duration: __ENV.SPIKE_DURATION || "7m", target: 16 },
        { duration: __ENV.SOAK_DURATION || "30m", target: 5 },
      ],
      preAllocatedVUs: 20, maxVUs: 80,
    },
    notifications: { executor: "constant-arrival-rate", exec: "readNotifications", rate: 3, timeUnit: "1s", duration: "52m", startTime: "5m", preAllocatedVUs: 10, maxVUs: 30 },
    last_bag: { executor: "per-vu-iterations", exec: "buyLastBag", vus: 100, iterations: 1, startTime: __ENV.WRITE_START_TIME || "20m" },
    redeem: { executor: "constant-vus", exec: "redeemOrders", vus: 10, duration: "22m", startTime: "5m" },
    mass_expiry: { executor: "constant-vus", exec: "observeMassExpiry", vus: 10, duration: __ENV.SPIKE_DURATION || "7m", startTime: __ENV.WRITE_START_TIME || "20m" },
    provider_fault_enable: { executor: "shared-iterations", exec: "enableProviderFault", vus: 1, iterations: 1, startTime: __ENV.FAULT_ENABLE_TIME || "19m55s", maxDuration: "30s" },
    provider_degradation: { executor: "constant-arrival-rate", exec: "buyDuringProviderDegradation", rate: 10, timeUnit: "1s", duration: __ENV.SPIKE_DURATION || "7m", preAllocatedVUs: 30, maxVUs: 80, startTime: __ENV.WRITE_START_TIME || "20m" },
    provider_fault_verify: { executor: "shared-iterations", exec: "verifyProviderFault", vus: 1, iterations: 1, startTime: __ENV.FAULT_VERIFY_TIME || "20m15s", maxDuration: "30s" },
    provider_fault_disable: { executor: "shared-iterations", exec: "disableProviderFault", vus: 1, iterations: 1, startTime: __ENV.FAULT_DISABLE_TIME || "27m10s", maxDuration: "30s" },
  },
  thresholds: {
    checks: ["rate>0.99"],
    http_req_duration: ["p(95)<500", "p(99)<1200"],
    http_req_failed: ["rate<0.005"],
    business_failures: ["rate<0.01"],
    oversell_detected: ["count==0"],
    last_bag_orders_created: [`count==${fixtures.expectedLastBagWinners}`],
    provider_orders_created: [`count>=${fixtures.minimumProviderOrders}`],
    redeem_success: [`count>=${fixtures.minimumSuccessfulRedeems}`],
    provider_fault_enabled: ["count==1"],
    provider_fault_applied: ["count==1"],
    provider_degradation_latency: ["p(95)<1000"],
    catalog_latency: ["p(95)<400", "p(99)<900"],
    order_latency: ["p(95)<500", "p(99)<1000"],
    redeem_latency: ["p(95)<500", "p(99)<1000"],
    other_api_latency: ["p(95)<500", "p(99)<1200"],
  },
};

function customerCookie() {
  return fixtures.customers[(__VU + __ITER) % fixtures.customers.length].cookie;
}

function headers(cookie) {
  return { "Content-Type": "application/json", Cookie: cookie };
}

function controlParams(responseCallback = status200) {
  return { headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONTROL_SECRET}` }, responseCallback };
}

export function setup() {
  const missing = [];
  if (!BASE_URL) missing.push("BASE_URL");
  if (!CONTROL_SECRET) missing.push("LOAD_TEST_CONTROL_SECRET");
  if (!Array.isArray(fixtures.customers) || fixtures.customers.length < 100) missing.push("fixtures.customers>=100");
  if (!Array.isArray(fixtures.redeemAttempts) || fixtures.redeemAttempts.length === 0) missing.push("fixtures.redeemAttempts");
  for (const key of ["lastBagId", "degradedProviderBagId", "expiryBagId", "expectedLastBagWinners", "minimumProviderOrders", "minimumProviderHolds", "minimumSuccessfulRedeems"]) {
    if (!fixtures[key]) missing.push(`fixtures.${key}`);
  }
  if (missing.length) fail(`Missing required load inputs: ${missing.join(", ")}`);
  const response = http.del(`${BASE_URL}/api/internal/mock-payment-fault`, null, controlParams());
  if (!check(response, { "mock provider fault control is reachable": (r) => r.status === 200 })) fail("Cannot reset mock provider fault mode");
  return { runId: fixtures.runId };
}

export function teardown() {
  http.del(`${BASE_URL}/api/internal/mock-payment-fault`, null, controlParams());
}

export function enableProviderFault() {
  const response = http.post(`${BASE_URL}/api/internal/mock-payment-fault`, JSON.stringify({
    runId: fixtures.runId,
    delayMs: Number(__ENV.MOCK_PROVIDER_DELAY_MS || 250),
    errorRate: Number(__ENV.MOCK_PROVIDER_ERROR_RATE || 0.1),
    timeoutRate: Number(__ENV.MOCK_PROVIDER_TIMEOUT_RATE || 0.05),
    timeoutDelayMs: Number(__ENV.MOCK_PROVIDER_TIMEOUT_DELAY_MS || 15_000),
    enabledSeconds: Number(__ENV.MOCK_PROVIDER_FAULT_SECONDS || 600),
  }), controlParams());
  if (response.status !== 200) {
    exec.test.abort(`Cannot enable provider fault mode: HTTP ${response.status}: ${response.body}`);
  }
  const body = response.json();
  if (body.runId !== fixtures.runId || body.enabled !== true) {
    exec.test.abort("Provider fault endpoint returned unexpected state");
  }
  providerFaultEnabled.add(1);
}

export function verifyProviderFault() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = http.get(
      `${BASE_URL}/api/internal/mock-payment-fault?runId=${encodeURIComponent(fixtures.runId)}`,
      controlParams()
    );
    if (response.status === 200) {
      const body = response.json();
      if (body.runId === fixtures.runId && body.configured === true && body.applied === true && Number(body.statistics?.appliedCount) > 0) {
        providerFaultApplied.add(1);
        return;
      }
    }
    sleep(1);
  }
  exec.test.abort("Payment worker did not acknowledge mock provider fault mode");
}

export function disableProviderFault() {
  const response = http.del(`${BASE_URL}/api/internal/mock-payment-fault`, null, controlParams());
  check(response, { "provider fault mode disabled": (r) => r.status === 200 });
}

export function browseCatalog() {
  const cursor = Math.random() > 0.7 ? "&minDiscount=50&maxPrice=2500" : "";
  const response = http.get(`${BASE_URL}/api/bags?city=almaty&sort=distance&lat=43.2389&lng=76.8897${cursor}`, { responseCallback: status200 });
  catalogLatency.add(response.timings.duration);
  check(response, { "catalog 200": (r) => r.status === 200, "catalog has bags": (r) => Array.isArray(r.json("bags")) });
  sleep(Math.random());
}

export function buyLastBag() {
  const response = http.post(`${BASE_URL}/api/orders`, JSON.stringify({ bagId: fixtures.lastBagId, quantity: 1 }), {
    headers: { ...headers(customerCookie()), "Idempotency-Key": `k6-last-${__VU}-${__ITER}` },
    responseCallback: orderRaceStatuses,
  });
  orderLatency.add(response.timings.duration);
  const accepted = response.status === 201;
  const soldOut = response.status === 409;
  if (accepted) {
    lastBagCreated.add(1);
    if (Number(response.json("order.bag.quantityLeft")) < 0) oversell.add(1);
  }
  businessFailures.add(!accepted && !soldOut);
  check(response, { "last bag returns created or sold out": () => accepted || soldOut, "last bag is never rate limited": (r) => r.status !== 429 });
}

export function redeemOrders() {
  const attempt = fixtures.redeemAttempts[(__VU * 17 + __ITER) % fixtures.redeemAttempts.length];
  const response = http.post(`${BASE_URL}/api/business/redeem`, JSON.stringify({ code: attempt.code }), {
    headers: headers(attempt.cookie), responseCallback: redeemStatuses,
  });
  redeemLatency.add(response.timings.duration);
  if (response.status === 200) redeemSuccess.add(1);
  businessFailures.add(![200, 409].includes(response.status));
  check(response, { "redeem accepted or already claimed": (r) => [200, 409].includes(r.status), "redeem is never rate limited": (r) => r.status !== 429 });
  sleep(0.5);
}

export function readOrderHistory() {
  const response = http.get(`${BASE_URL}/api/orders?scope=history&limit=20`, { headers: headers(customerCookie()), responseCallback: status200 });
  apiLatency.add(response.timings.duration);
  check(response, { "order history available": (r) => r.status === 200 });
}

export function readNotifications() {
  const response = http.get(`${BASE_URL}/api/notifications`, { headers: headers(customerCookie()), responseCallback: status200 });
  apiLatency.add(response.timings.duration);
  check(response, { "notifications available": (r) => r.status === 200 });
}

export function observeMassExpiry() {
  const catalog = http.get(`${BASE_URL}/api/bags?city=almaty&q=LOAD%20mass%20expiry`, { responseCallback: status200 });
  const deep = http.get(`${BASE_URL}/api/health/deep`, { responseCallback: status200 });
  catalogLatency.add(catalog.timings.duration);
  check(catalog, { "catalog remains available during expiry": (r) => r.status === 200 });
  check(deep, { "deep health remains observable": (r) => r.status === 200 });
  sleep(1);
}

export function buyDuringProviderDegradation() {
  const started = Date.now();
  const response = http.post(`${BASE_URL}/api/orders`, JSON.stringify({ bagId: fixtures.degradedProviderBagId, quantity: 1 }), {
    headers: { ...headers(customerCookie()), "Idempotency-Key": `k6-degraded-${__VU}-${__ITER}` },
    responseCallback: orderCreatedStatus,
  });
  providerLatency.add(Date.now() - started);
  if (response.status === 201) providerOrdersCreated.add(1);
  businessFailures.add(response.status !== 201);
  check(response, { "degradation order is queued": (r) => r.status === 201, "degradation order is never rate limited": (r) => r.status !== 429 });
}
