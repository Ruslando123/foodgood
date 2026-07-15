import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "").replace(/\/$/, "");
const catalogLatency = new Trend("staging_catalog_latency", true);

export const options = {
  scenarios: {
    catalog: {
      executor: "ramping-arrival-rate",
      startRate: Number(__ENV.START_RATE || 5),
      timeUnit: "1s",
      stages: [
        { duration: __ENV.WARMUP_DURATION || "30s", target: Number(__ENV.NORMAL_RATE || 20) },
        { duration: __ENV.PEAK_DURATION || "2m", target: Number(__ENV.PEAK_RATE || 50) },
        { duration: __ENV.COOLDOWN_DURATION || "30s", target: 5 },
      ],
      preAllocatedVUs: 30,
      maxVUs: 120,
    },
  },
  thresholds: {
    checks: ["rate>0.995"],
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<500", "p(99)<1200"],
    staging_catalog_latency: ["p(95)<400", "p(99)<900"],
  },
};

export function setup() {
  if (!BASE_URL) fail("BASE_URL is required");
  const ready = http.get(`${BASE_URL}/api/health/ready`);
  if (!check(ready, { "staging is ready": (response) => response.status === 200 })) fail("Staging is not ready");
}

export default function stagingCatalog() {
  const catalog = http.get(`${BASE_URL}/api/bags?city=almaty&sort=distance&lat=43.2389&lng=76.8897`);
  catalogLatency.add(catalog.timings.duration);
  check(catalog, {
    "catalog 200": (response) => response.status === 200,
    "catalog payload": (response) => Array.isArray(response.json("bags")),
  });
  if (__ITER % 20 === 0) {
    const ready = http.get(`${BASE_URL}/api/health/ready`);
    check(ready, { "ready 200": (response) => response.status === 200 });
  }
  sleep(Math.random() * 0.2);
}
