import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

type ReservationBagFixture = {
  id: string;
  expectedReservations: number;
};

type LoadFixtures = {
  runId: string;
  warmupCustomer: { cookie: string };
  warmupBagId: string;
  expectedWarmupReservations: number;
  reservationBags: ReservationBagFixture[];
  expectedDistributedReservations: number;
  hotBagId: string;
  expectedHotReservations: number;
  lastBagId: string;
  expectedLastBagWinners: number;
  expectedSuccessfulRedeems?: number;
  minimumSuccessfulRedeems: number;
  redeemAttempts: Array<{ code: string }>;
};

const profile = process.env.LOAD_PROFILE ?? "normal";
if (!(["normal", "hot", "ramp", "soak", "all"] as const).includes(profile as "normal" | "hot" | "ramp" | "soak" | "all")) {
  throw new Error(`LOAD_PROFILE must be normal, hot, ramp, soak, or all; received ${profile}`);
}

const checksNormalProfile = profile === "normal" || profile === "ramp" || profile === "soak" || profile === "all";
const checksHotProfile = profile === "hot" || profile === "all";
const timeoutMs = Number(process.env.LOAD_DRAIN_TIMEOUT_MS ?? 5 * 60_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30 * 60_000) {
  throw new Error("LOAD_DRAIN_TIMEOUT_MS must be an integer between 0 and 1800000");
}

const fixtureFile = path.resolve(process.env.LOAD_FIXTURE_FILE ?? "load/fixtures.local.json");
const fixtures = JSON.parse(readFileSync(fixtureFile, "utf8")) as LoadFixtures;

if (!fixtures.runId) throw new Error("Load fixture is missing runId");
if (checksNormalProfile && !fixtures.reservationBags?.length) {
  throw new Error("Normal profile requires reservationBags in the load fixture");
}
if (checksHotProfile && (!fixtures.hotBagId || !fixtures.lastBagId)) {
  throw new Error("Hot profile requires hotBagId and lastBagId in the load fixture");
}
if (checksNormalProfile) {
  const expectedReservations = fixtures.reservationBags.reduce((total, bag) => total + bag.expectedReservations, 0);
  if (!Number.isInteger(fixtures.expectedDistributedReservations) || fixtures.expectedDistributedReservations < 1
    || expectedReservations !== fixtures.expectedDistributedReservations) {
    throw new Error("Normal profile fixture has inconsistent distributed reservation totals");
  }
  if (!Array.isArray(fixtures.redeemAttempts) || !fixtures.redeemAttempts.length) {
    throw new Error("Normal profile requires redeemAttempts in the load fixture");
  }
  if (!fixtures.warmupCustomer?.cookie || !fixtures.warmupBagId || fixtures.expectedWarmupReservations !== 1) {
    throw new Error("Normal profile requires a single dedicated warmup customer and bag");
  }
  if (fixtures.reservationBags.some((bag) => bag.id === fixtures.warmupBagId)) {
    throw new Error("Normal profile warmup bag must be isolated from measured reservation fixtures");
  }
}
if (checksHotProfile && (
  !Number.isInteger(fixtures.expectedHotReservations) || fixtures.expectedHotReservations < 1
  || !Number.isInteger(fixtures.expectedLastBagWinners) || fixtures.expectedLastBagWinners < 1
)) {
  throw new Error("Hot profile fixture has invalid expected reservation counts");
}

const expectedSuccessfulRedeems = fixtures.expectedSuccessfulRedeems ?? fixtures.minimumSuccessfulRedeems;
if (checksNormalProfile && (
  !Number.isInteger(expectedSuccessfulRedeems) || expectedSuccessfulRedeems !== fixtures.redeemAttempts.length
)) {
  throw new Error("Normal profile fixture must expect every unique redeem attempt to complete");
}

async function activeQueueDepth() {
  return prisma.batchJob.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] }, NOT: { type: "PICKUP_REMINDER", nextAttemptAt: { gt: new Date() } } } });
}

async function distributedReservationReport() {
  if (!checksNormalProfile) return null;

  const ids = fixtures.reservationBags.map((bag) => bag.id);
  const [bags, orderCounts] = await Promise.all([
    prisma.bag.findMany({ where: { id: { in: ids } }, select: { id: true, quantityLeft: true, status: true } }),
    prisma.order.groupBy({ by: ["bagId"], where: { bagId: { in: ids }, status: "RESERVED" }, _count: { _all: true } }),
  ]);
  const stateById = new Map(bags.map((bag) => [bag.id, { quantityLeft: bag.quantityLeft, status: bag.status }]));
  const ordersByBagId = new Map(orderCounts.map((entry) => [entry.bagId, entry._count._all]));
  const bagsReport = fixtures.reservationBags.map((fixture) => ({
    id: fixture.id,
    completed: ordersByBagId.get(fixture.id) ?? 0,
    expected: fixture.expectedReservations,
    quantityLeft: stateById.get(fixture.id)?.quantityLeft ?? null,
    status: stateById.get(fixture.id)?.status ?? null,
  }));

  return {
    completed: bagsReport.reduce((total, bag) => total + bag.completed, 0),
    expected: fixtures.expectedDistributedReservations,
    failedBags: bagsReport.filter((bag) =>
      bag.completed !== bag.expected || bag.quantityLeft !== 0 || bag.status !== "SOLD_OUT"
    ),
  };
}

async function main() {
  const started = Date.now();
  let queueRemaining = await activeQueueDepth();
  while (queueRemaining > 0 && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    queueRemaining = await activeQueueDepth();
  }

  const redeemCodes = checksNormalProfile ? [...new Set(fixtures.redeemAttempts.map((attempt) => attempt.code))] : [];
  const [negativeInventory, failedJobs, expiredJobLeases, warmupBag, warmupReservations, distributedReservations, hotBag, hotReservations, lastBag, lastBagWinners, successfulRedeems] = await Promise.all([
    prisma.bag.count({ where: { quantityLeft: { lt: 0 } } }),
    prisma.batchJob.count({ where: { status: "FAILED" } }),
    prisma.batchJob.count({ where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } } }),
    checksNormalProfile ? prisma.bag.findUniqueOrThrow({ where: { id: fixtures.warmupBagId }, select: { quantityLeft: true, status: true } }) : null,
    checksNormalProfile ? prisma.order.count({ where: { bagId: fixtures.warmupBagId, status: "RESERVED" } }) : null,
    distributedReservationReport(),
    checksHotProfile ? prisma.bag.findUniqueOrThrow({ where: { id: fixtures.hotBagId }, select: { quantityLeft: true, status: true } }) : null,
    checksHotProfile ? prisma.order.count({ where: { bagId: fixtures.hotBagId, status: "RESERVED" } }) : null,
    checksHotProfile ? prisma.bag.findUniqueOrThrow({ where: { id: fixtures.lastBagId }, select: { quantityLeft: true, status: true } }) : null,
    checksHotProfile ? prisma.order.count({ where: { bagId: fixtures.lastBagId } }) : null,
    checksNormalProfile ? prisma.order.count({ where: { pickupCode: { in: redeemCodes }, status: "COMPLETED" } }) : null,
  ]);

  const report = {
    profile,
    runId: fixtures.runId,
    queueDrainMs: Date.now() - started,
    queueRemaining,
    negativeInventory,
    failedJobs,
    expiredJobLeases,
    warmupReservation: checksNormalProfile ? {
      completed: warmupReservations,
      expected: fixtures.expectedWarmupReservations,
      quantityLeft: warmupBag?.quantityLeft,
      status: warmupBag?.status,
    } : null,
    distributedReservations,
    hotReservations: checksHotProfile ? {
      completed: hotReservations,
      expected: fixtures.expectedHotReservations,
      quantityLeft: hotBag?.quantityLeft,
      status: hotBag?.status,
    } : null,
    lastBag: checksHotProfile ? {
      winners: lastBagWinners,
      expected: fixtures.expectedLastBagWinners,
      quantityLeft: lastBag?.quantityLeft,
      status: lastBag?.status,
    } : null,
    redeem: checksNormalProfile ? { completed: successfulRedeems, expected: expectedSuccessfulRedeems } : null,
  };
  console.log(JSON.stringify(report, null, 2));

  const distributedFailed = distributedReservations !== null && (
    distributedReservations.completed !== distributedReservations.expected
    || distributedReservations.failedBags.length > 0
  );
  const warmupFailed = checksNormalProfile && (
    warmupReservations !== fixtures.expectedWarmupReservations
    || warmupBag?.quantityLeft !== 0
    || warmupBag?.status !== "SOLD_OUT"
  );
  const hotFailed = checksHotProfile && (
    hotReservations !== fixtures.expectedHotReservations
    || hotBag?.quantityLeft !== 0
    || hotBag?.status !== "SOLD_OUT"
    || lastBagWinners !== fixtures.expectedLastBagWinners
    || lastBag?.quantityLeft !== 0
    || lastBag?.status !== "SOLD_OUT"
  );
  const redeemFailed = checksNormalProfile && successfulRedeems !== expectedSuccessfulRedeems;

  if (queueRemaining || negativeInventory || failedJobs || expiredJobLeases || warmupFailed || distributedFailed || hotFailed || redeemFailed) {
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
