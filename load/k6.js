import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const CUSTOMER_COOKIE = __ENV.CUSTOMER_COOKIE || "";
const MERCHANT_COOKIE = __ENV.MERCHANT_COOKIE || "";
const LAST_BAG_ID = __ENV.LAST_BAG_ID || "seed-last-bag";
const PICKUP_CODES = (__ENV.PICKUP_CODES || "").split(",").filter(Boolean);

const businessFailures = new Rate("business_failures");
const oversell = new Counter("oversell_detected");
const providerLatency = new Trend("provider_degradation_latency", true);

export const options = {
  scenarios: {
    catalog: { executor: "constant-arrival-rate", exec: "browseCatalog", rate: 40, timeUnit: "1s", duration: "3m", preAllocatedVUs: 30, maxVUs: 100 },
    last_bag: { executor: "per-vu-iterations", exec: "buyLastBag", vus: 50, iterations: 1, startTime: "20s" },
    redeem: { executor: "constant-vus", exec: "redeemOrders", vus: 10, duration: "90s", startTime: "40s" },
    mass_expiry: { executor: "constant-vus", exec: "observeMassExpiry", vus: 10, duration: "2m", startTime: "1m" },
    provider_degradation: { executor: "constant-arrival-rate", exec: "buyDuringProviderDegradation", rate: 10, timeUnit: "1s", duration: "2m", preAllocatedVUs: 30, maxVUs: 80, startTime: "3m" },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1200"],
    http_req_failed: ["rate<0.02"],
    business_failures: ["rate<0.05"],
    oversell_detected: ["count==0"],
    provider_degradation_latency: ["p(95)<11000"],
  },
};

const headers = (cookie) => ({ "Content-Type": "application/json", Cookie: cookie });

export function browseCatalog() {
  const cursor = Math.random() > 0.7 ? "&minDiscount=50&maxPrice=2500" : "";
  const response = http.get(`${BASE_URL}/api/bags?city=almaty&sort=distance&lat=43.2389&lng=76.8897${cursor}`);
  check(response, { "catalog 200": (r) => r.status === 200, "catalog has bags": (r) => Array.isArray(r.json("bags")) });
  sleep(Math.random());
}

export function buyLastBag() {
  const response = http.post(`${BASE_URL}/api/orders`, JSON.stringify({ bagId: LAST_BAG_ID, quantity: 1 }), {
    headers: { ...headers(CUSTOMER_COOKIE), "Idempotency-Key": `k6-last-${__VU}-${__ITER}` },
  });
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
  check(response, { "redeem accepted or already claimed": (r) => [200, 409].includes(r.status) });
  sleep(0.5);
}

export function observeMassExpiry() {
  const response = http.get(`${BASE_URL}/api/health`);
  check(response, { "service remains available during expiry": (r) => [200, 503].includes(r.status) });
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
