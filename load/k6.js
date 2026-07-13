import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const CUSTOMER_COOKIE = __ENV.CUSTOMER_COOKIE || "";
const MERCHANT_COOKIE = __ENV.MERCHANT_COOKIE || "";
const LAST_BAG_ID = __ENV.LAST_BAG_ID || "seed-last-bag";
const PICKUP_CODES = (__ENV.PICKUP_CODES || "").split(",").filter(Boolean);

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409, 429));

const businessFailures = new Rate("business_failures");
const oversell = new Counter("oversell_detected");
const providerLatency = new Trend("provider_degradation_latency", true);
const catalogLatency = new Trend("catalog_latency", true);
const orderLatency = new Trend("order_latency", true);
const redeemLatency = new Trend("redeem_latency", true);
const apiLatency = new Trend("other_api_latency", true);

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
    last_bag: { executor: "per-vu-iterations", exec: "buyLastBag", vus: 100, iterations: 1, startTime: "20m" },
    redeem: { executor: "constant-vus", exec: "redeemOrders", vus: 10, duration: "22m", startTime: "5m" },
    mass_expiry: { executor: "constant-vus", exec: "observeMassExpiry", vus: 10, duration: "7m", startTime: "20m" },
    provider_degradation: { executor: "constant-arrival-rate", exec: "buyDuringProviderDegradation", rate: 10, timeUnit: "1s", duration: "7m", preAllocatedVUs: 30, maxVUs: 80, startTime: "20m" },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1200"],
    http_req_failed: ["rate<0.005"],
    business_failures: ["rate<0.05"],
    oversell_detected: ["count==0"],
    provider_degradation_latency: ["p(95)<11000"],
    catalog_latency: ["p(95)<400", "p(99)<900"],
    order_latency: ["p(95)<500", "p(99)<1000"],
    redeem_latency: ["p(95)<500", "p(99)<1000"],
    other_api_latency: ["p(95)<500", "p(99)<1200"],
  },
};

const headers = (cookie) => ({ "Content-Type": "application/json", Cookie: cookie });

export function browseCatalog() {
  const cursor = Math.random() > 0.7 ? "&minDiscount=50&maxPrice=2500" : "";
  const response = http.get(`${BASE_URL}/api/bags?city=almaty&sort=distance&lat=43.2389&lng=76.8897${cursor}`);
  catalogLatency.add(response.timings.duration);
  check(response, { "catalog 200": (r) => r.status === 200, "catalog has bags": (r) => Array.isArray(r.json("bags")) });
  sleep(Math.random());
}

export function buyLastBag() {
  const response = http.post(`${BASE_URL}/api/orders`, JSON.stringify({ bagId: LAST_BAG_ID, quantity: 1 }), {
    headers: { ...headers(CUSTOMER_COOKIE), "Idempotency-Key": `k6-last-${__VU}-${__ITER}` },
  });
  orderLatency.add(response.timings.duration);
  const accepted = response.status === 201;
  const soldOut = response.status === 409;
  if (accepted && Number(response.json("order.bag.quantityLeft")) < 0) oversell.add(1);
  businessFailures.add(!accepted && !soldOut);
  check(response, { "last bag safely decided": () => accepted || soldOut });
}

export function redeemOrders() {
  if (!PICKUP_CODES.length) return sleep(1);
  const code = PICKUP_CODES[(__VU + __ITER) % PICKUP_CODES.length];
  const response = http.post(`${BASE_URL}/api/business/redeem`, JSON.stringify({ code }), { headers: headers(MERCHANT_COOKIE) });
  redeemLatency.add(response.timings.duration);
  check(response, { "redeem accepted or already claimed": (r) => [200, 409].includes(r.status) });
  sleep(0.5);
}

export function readOrderHistory() {
  const response = http.get(`${BASE_URL}/api/orders?scope=history&limit=20`, { headers: headers(CUSTOMER_COOKIE) });
  apiLatency.add(response.timings.duration);
  check(response, { "order history available": (r) => r.status === 200 });
}

export function readNotifications() {
  const response = http.get(`${BASE_URL}/api/notifications`, { headers: headers(CUSTOMER_COOKIE) });
  apiLatency.add(response.timings.duration);
  check(response, { "notifications available": (r) => r.status === 200 });
}

export function observeMassExpiry() {
  const catalog = http.get(`${BASE_URL}/api/bags?city=almaty&q=LOAD%20mass%20expiry`);
  const deep = http.get(`${BASE_URL}/api/health/deep`);
  catalogLatency.add(catalog.timings.duration);
  check(catalog, { "catalog remains available during expiry": (r) => r.status === 200 });
  check(deep, { "deep health remains observable": (r) => r.status === 200 });
  sleep(1);
}

export function buyDuringProviderDegradation() {
  const started = Date.now();
  const response = http.post(`${BASE_URL}/api/orders`, JSON.stringify({ bagId: __ENV.DEGRADED_PROVIDER_BAG_ID || LAST_BAG_ID, quantity: 1 }), {
    headers: { ...headers(CUSTOMER_COOKIE), "Idempotency-Key": `k6-degraded-${__VU}-${__ITER}` },
  });
  providerLatency.add(Date.now() - started);
  check(response, { "HTTP is bounded while provider is degraded": (r) => [201, 409, 429].includes(r.status) });
}
