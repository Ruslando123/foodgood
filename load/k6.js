import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PROFILE = __ENV.LOAD_PROFILE || "normal";
/** @type {{
 * runId: string,
 * customers: Array<{ cookie: string }>,
 * warmupCustomer?: { cookie: string },
 * warmupBagId?: string,
 * expectedWarmupReservations?: number,
 * reservationBags?: Array<{ id: string }>,
 * redeemAttempts?: Array<{ cookie: string, code: string }>,
 * hotBagId?: string,
 * lastBagId?: string,
 * }} */
const fixtures = JSON.parse(open(__ENV.LOAD_FIXTURE_FILE || "./fixtures.local.json"));

if (!["normal", "hot", "ramp", "soak", "all"].includes(PROFILE)) {
  throw new Error(`LOAD_PROFILE must be normal, hot, ramp, soak, or all; received ${PROFILE}`);
}
// Ramp and soak retain the exact, finite normal-profile mutation wave while
// changing only the catalog traffic model. This keeps their database outcome
// deterministic even though catalog arrivals are open-model.
const runsNormalProfile = ["normal", "ramp", "soak", "all"].includes(PROFILE);
const runsHotProfile = PROFILE === "hot" || PROFILE === "all";
if (!fixtures.runId || !Array.isArray(fixtures.customers) || !fixtures.customers.length) {
  throw new Error("Load fixture must contain runId and at least one customer");
}
if (runsNormalProfile && (!Array.isArray(fixtures.reservationBags) || !fixtures.reservationBags.length)) {
  throw new Error("Normal profile requires reservationBags in the load fixture");
}
if (runsNormalProfile && (!Array.isArray(fixtures.redeemAttempts) || !fixtures.redeemAttempts.length)) {
  throw new Error("Normal profile requires redeemAttempts in the load fixture");
}
if (runsNormalProfile && (!fixtures.warmupCustomer?.cookie || !fixtures.warmupBagId || fixtures.expectedWarmupReservations !== 1)) {
  throw new Error("Normal profile requires a single dedicated warmup customer and bag");
}
if (runsNormalProfile && (
  fixtures.customers.some((customer) => customer.cookie === fixtures.warmupCustomer.cookie)
  || fixtures.reservationBags.some((bag) => bag.id === fixtures.warmupBagId)
)) {
  throw new Error("Normal profile warmup customer and bag must be isolated from measured fixtures");
}
if (runsHotProfile && (!fixtures.hotBagId || !fixtures.lastBagId)) {
  throw new Error("Hot profile requires hotBagId and lastBagId in the load fixture");
}

const customers = new SharedArray("customers", () => fixtures.customers);
const reservationBags = runsNormalProfile
  ? new SharedArray("reservation-bags", () => fixtures.reservationBags || [])
  : [];
const redeemAttempts = runsNormalProfile
  ? new SharedArray("redeem-attempts", () => fixtures.redeemAttempts || [])
  : [];

function integerEnv(name, fallback, minimum = 1) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}

function durationEnv(name, fallback) {
  const value = __ENV[name] || fallback;
  if (!/^\d+(ms|s|m|h)$/.test(value)) throw new Error(`${name} must be a k6 duration such as 30s or 2m`);
  return value;
}

function thresholdEnv(name, fallback) {
  return integerEnv(name, fallback, 1);
}

function rateEnv(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`${name} must be a number between 0 and 1`);
  return value;
}

const catalogDuration = new Trend("catalog_duration", true);
const distributedReserveDuration = new Trend("distributed_reserve_duration", true);
const hotReserveDuration = new Trend("hot_reserve_duration", true);
const redeemDuration = new Trend("redeem_duration", true);
const lastBagDuration = new Trend("last_bag_duration", true);
const catalogUnexpected = new Rate("catalog_unexpected");
const distributedReserveUnexpected = new Rate("distributed_reserve_unexpected");
const hotReserveUnexpected = new Rate("hot_reserve_unexpected");
const redeemUnexpected = new Rate("redeem_unexpected");
const lastBagUnexpected = new Rate("last_bag_unexpected");
let distributedReserveVUs = 1;
let distributedReserveStaggerMs = 0;

/** @returns {{ [name: string]: import("k6/options").Scenario }} */
function normalCatalogScenario() {
  const catalogPreAllocatedVUs = integerEnv(
    "NORMAL_CATALOG_PREALLOCATED_VUS",
    // Keep the old knob as a preallocation fallback without restoring its
    // former unbounded constant-VU request rate.
    __ENV.NORMAL_CATALOG_VUS || 100,
  );
  const catalogMaxVUs = integerEnv("NORMAL_CATALOG_MAX_VUS", 150);
  if (catalogMaxVUs < catalogPreAllocatedVUs) {
    throw new Error("NORMAL_CATALOG_MAX_VUS must be >= NORMAL_CATALOG_PREALLOCATED_VUS");
  }
  return {
    executor: "constant-arrival-rate",
    exec: "catalog",
    rate: integerEnv("NORMAL_CATALOG_RATE", 100),
    timeUnit: "1s",
    duration: durationEnv("NORMAL_CATALOG_DURATION", "2m"),
    preAllocatedVUs: catalogPreAllocatedVUs,
    maxVUs: catalogMaxVUs,
  };
}

function openCatalogScenario(profile) {
  const prefix = profile.toUpperCase();
  const preAllocatedVUs = integerEnv(`${prefix}_CATALOG_PREALLOCATED_VUS`, profile === "ramp" ? 200 : 150);
  const maxVUs = integerEnv(`${prefix}_CATALOG_MAX_VUS`, profile === "ramp" ? 500 : 300);
  if (maxVUs < preAllocatedVUs) {
    throw new Error(`${prefix}_CATALOG_MAX_VUS must be >= ${prefix}_CATALOG_PREALLOCATED_VUS`);
  }

  if (profile === "soak") {
    return {
      executor: "constant-arrival-rate",
      exec: "catalog",
      rate: integerEnv("SOAK_CATALOG_RATE", 100),
      timeUnit: "1s",
      duration: durationEnv("SOAK_DURATION", "30m"),
      preAllocatedVUs,
      maxVUs,
    };
  }

  const startRate = integerEnv("RAMP_START_RATE", 25);
  const warmupRate = integerEnv("RAMP_WARMUP_RATE", 50);
  const steadyRate = integerEnv("RAMP_STEADY_RATE", 100);
  const peakRate = integerEnv("RAMP_PEAK_RATE", 200);
  const recoveryRate = integerEnv("RAMP_RECOVERY_RATE", 50);
  if (startRate > warmupRate || warmupRate > steadyRate || steadyRate > peakRate || recoveryRate > peakRate) {
    throw new Error("Ramp rates must satisfy start <= warmup <= steady <= peak and recovery <= peak");
  }

  return {
    executor: "ramping-arrival-rate",
    exec: "catalog",
    startRate,
    timeUnit: "1s",
    stages: [
      { duration: durationEnv("RAMP_WARMUP_DURATION", "1m"), target: warmupRate },
      { duration: durationEnv("RAMP_STEADY_DURATION", "3m"), target: steadyRate },
      { duration: durationEnv("RAMP_PEAK_DURATION", "2m"), target: peakRate },
      { duration: durationEnv("RAMP_RECOVERY_DURATION", "1m"), target: recoveryRate },
    ],
    preAllocatedVUs,
    maxVUs,
  };
}

/** @returns {{ [name: string]: import("k6/options").Scenario }} */
function exactMutationScenarios() {
  const mutationStartTime = durationEnv("NORMAL_MUTATION_START_TIME", "5s");
  distributedReserveVUs = Math.min(integerEnv("NORMAL_RESERVE_VUS", 20), customers.length);
  distributedReserveStaggerMs = integerEnv("NORMAL_RESERVE_STAGGER_MS", 25, 0);
  return {
    distributed_reserve: {
      executor: "shared-iterations",
      exec: "distributedReserve",
      vus: distributedReserveVUs,
      iterations: customers.length,
      startTime: durationEnv("NORMAL_RESERVE_START_TIME", mutationStartTime),
      maxDuration: durationEnv("NORMAL_RESERVE_MAX_DURATION", "2m"),
    },
    redeem: {
      executor: "shared-iterations",
      exec: "redeem",
      vus: Math.min(integerEnv("NORMAL_REDEEM_VUS", 10), redeemAttempts.length),
      iterations: redeemAttempts.length,
      startTime: durationEnv("NORMAL_REDEEM_START_TIME", mutationStartTime),
      maxDuration: durationEnv("NORMAL_REDEEM_MAX_DURATION", "2m"),
    },
  };
}

/** @returns {{ [name: string]: import("k6/options").Scenario }} */
function hotScenarios() {
  return {
    hot_reserve: {
      executor: "shared-iterations",
      exec: "hotReserve",
      vus: Math.min(integerEnv("HOT_RESERVE_VUS", 50), customers.length),
      iterations: customers.length,
      maxDuration: durationEnv("HOT_RESERVE_MAX_DURATION", "5m"),
    },
    last_bag_race: {
      executor: "shared-iterations",
      exec: "lastBagRace",
      vus: Math.min(integerEnv("LAST_BAG_VUS", 20), customers.length),
      iterations: Math.min(integerEnv("LAST_BAG_ATTEMPTS", 20), customers.length),
      maxDuration: durationEnv("LAST_BAG_MAX_DURATION", "30s"),
    },
  };
}

function normalThresholds() {
  const unexpectedRate = rateEnv("NORMAL_UNEXPECTED_RATE", 0.005);
  return {
    catalog_duration: [
      `p(95)<${thresholdEnv("NORMAL_CATALOG_P95_MS", 400)}`,
      `p(99)<${thresholdEnv("NORMAL_CATALOG_P99_MS", 900)}`,
    ],
    distributed_reserve_duration: [
      `p(95)<${thresholdEnv("NORMAL_RESERVE_P95_MS", 750)}`,
      `p(99)<${thresholdEnv("NORMAL_RESERVE_P99_MS", 1500)}`,
    ],
    redeem_duration: [
      `p(95)<${thresholdEnv("NORMAL_REDEEM_P95_MS", 750)}`,
      `p(99)<${thresholdEnv("NORMAL_REDEEM_P99_MS", 1500)}`,
    ],
    catalog_unexpected: [`rate<${unexpectedRate}`],
    "dropped_iterations{scenario:catalog}": ["count==0"],
    distributed_reserve_unexpected: [`rate<${unexpectedRate}`],
    redeem_unexpected: [`rate<${unexpectedRate}`],
  };
}

function openCatalogThresholds(profile) {
  const prefix = profile.toUpperCase();
  const unexpectedRate = rateEnv(`${prefix}_UNEXPECTED_RATE`, 0.005);
  return {
    catalog_duration: [
      `p(95)<${thresholdEnv(`${prefix}_CATALOG_P95_MS`, 400)}`,
      `p(99)<${thresholdEnv(`${prefix}_CATALOG_P99_MS`, 900)}`,
    ],
    catalog_unexpected: [`rate<${unexpectedRate}`],
    "dropped_iterations{scenario:catalog}": ["count==0"],
  };
}

function exactMutationThresholds() {
  const unexpectedRate = rateEnv("NORMAL_UNEXPECTED_RATE", 0.005);
  return {
    distributed_reserve_duration: [
      `p(95)<${thresholdEnv("NORMAL_RESERVE_P95_MS", 750)}`,
      `p(99)<${thresholdEnv("NORMAL_RESERVE_P99_MS", 1500)}`,
    ],
    redeem_duration: [
      `p(95)<${thresholdEnv("NORMAL_REDEEM_P95_MS", 750)}`,
      `p(99)<${thresholdEnv("NORMAL_REDEEM_P99_MS", 1500)}`,
    ],
    distributed_reserve_unexpected: [`rate<${unexpectedRate}`],
    redeem_unexpected: [`rate<${unexpectedRate}`],
  };
}

function hotThresholds() {
  const unexpectedRate = rateEnv("HOT_UNEXPECTED_RATE", 0.005);
  return {
    hot_reserve_duration: [
      `p(95)<${thresholdEnv("HOT_RESERVE_P95_MS", 2500)}`,
      `p(99)<${thresholdEnv("HOT_RESERVE_P99_MS", 5000)}`,
    ],
    last_bag_duration: [`p(95)<${thresholdEnv("LAST_BAG_P95_MS", 2500)}`],
    hot_reserve_unexpected: [`rate<${unexpectedRate}`],
    last_bag_unexpected: [`rate<${unexpectedRate}`],
  };
}

/** @type {import("k6/options").Options} */
export const options = {
  scenarios: {
    ...(PROFILE === "normal" || PROFILE === "all" ? { catalog: normalCatalogScenario() } : {}),
    ...(PROFILE === "ramp" || PROFILE === "soak" ? { catalog: openCatalogScenario(PROFILE) } : {}),
    ...(runsNormalProfile ? exactMutationScenarios() : {}),
    ...(runsHotProfile ? hotScenarios() : {}),
  },
  thresholds: {
    ...(PROFILE === "normal" || PROFILE === "all" ? normalThresholds() : {}),
    ...(PROFILE === "ramp" || PROFILE === "soak" ? openCatalogThresholds(PROFILE) : {}),
    ...(PROFILE === "ramp" || PROFILE === "soak" ? exactMutationThresholds() : {}),
    ...(runsHotProfile ? hotThresholds() : {}),
  },
};

function params(cookie, extraHeaders = {}, expectedStatuses) {
  return {
    headers: { "Content-Type": "application/json", Cookie: cookie, ...extraHeaders },
    ...(expectedStatuses ? { responseCallback: http.expectedStatuses(...expectedStatuses) } : {}),
  };
}

export function setup() {
  if (!runsNormalProfile) return;
  const response = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({ bagId: fixtures.warmupBagId, quantity: 1 }),
    params(fixtures.warmupCustomer.cookie, { "Idempotency-Key": `load-warmup-${fixtures.runId}` }, [201]),
  );
  const created = check(response, { "reservation path warmed": (result) => result.status === 201 });
  if (!created) throw new Error(`Reservation warmup failed with HTTP ${response.status}`);
}

export function catalog() {
  const response = http.get(`${BASE_URL}/api/bags?city=almaty&limit=20`);
  catalogDuration.add(response.timings.duration);
  catalogUnexpected.add(response.status !== 200);
  check(response, { "catalog 200": (result) => result.status === 200 });
}

export function distributedReserve() {
  const iteration = exec.scenario.iterationInTest;
  const staggerMs = (iteration % distributedReserveVUs) * distributedReserveStaggerMs;
  if (staggerMs > 0) sleep(staggerMs / 1_000);
  const customer = customers[iteration % customers.length];
  const bag = reservationBags[iteration % reservationBags.length];
  const response = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({ bagId: bag.id, quantity: 1 }),
    params(customer.cookie, { "Idempotency-Key": `load-distributed-${fixtures.runId}-${iteration}` }, [201]),
  );
  distributedReserveDuration.add(response.timings.duration);
  distributedReserveUnexpected.add(response.status !== 201);
  check(response, { "distributed reservation created": (result) => result.status === 201 });
}

export function hotReserve() {
  const iteration = exec.scenario.iterationInTest;
  const customer = customers[iteration % customers.length];
  const response = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({ bagId: fixtures.hotBagId, quantity: 1 }),
    params(customer.cookie, { "Idempotency-Key": `load-hot-${fixtures.runId}-${iteration}` }, [201]),
  );
  hotReserveDuration.add(response.timings.duration);
  hotReserveUnexpected.add(response.status !== 201);
  check(response, { "hot-row reservation created": (result) => result.status === 201 });
}

export function lastBagRace() {
  const iteration = exec.scenario.iterationInTest;
  const customer = customers[iteration % customers.length];
  const response = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({ bagId: fixtures.lastBagId, quantity: 1 }),
    params(customer.cookie, { "Idempotency-Key": `last-bag-${fixtures.runId}-${iteration}` }, [201, 409]),
  );
  lastBagDuration.add(response.timings.duration);
  lastBagUnexpected.add(response.status !== 201 && response.status !== 409);
  check(response, { "single-bag race handled": (result) => result.status === 201 || result.status === 409 });
}

export function redeem() {
  const attempt = redeemAttempts[exec.scenario.iterationInTest % redeemAttempts.length];
  const response = http.post(
    `${BASE_URL}/api/business/redeem`,
    JSON.stringify({ code: attempt.code, cashReceivedConfirmed: true }),
    params(attempt.cookie, {}, [200]),
  );
  redeemDuration.add(response.timings.duration);
  redeemUnexpected.add(response.status !== 200);
  check(response, { "redeem completed": (result) => result.status === 200 });
}
