import { prisma } from "./db";

export type MockPaymentFault = {
  runId: string;
  delayMs: number;
  errorRate: number;
  timeoutRate: number;
  timeoutDelayMs: number;
  enabledUntil: string;
};

export type MockFaultStats = {
  runId: string;
  delayMs: number;
  errorRate: number;
  timeoutRate: number;
  timeoutDelayMs: number;
  appliedCount: number;
  delayedCount: number;
  errorCount: number;
  timeoutCount: number;
  firstAppliedAt: string | null;
  lastAppliedAt: string | null;
};

type PendingStats = MockFaultStats;

const STATE_KEY = "load:mock-payment-fault";
const STATS_PREFIX = "load:mock-payment-fault-stats:";
let cached: { value: MockPaymentFault | null; until: number } = { value: null, until: 0 };
const pendingByRun = new Map<string, PendingStats>();
let lastFlushAt = 0;
let flushInFlight: Promise<void> | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const statsKey = (runId: string) => `${STATS_PREFIX}${runId}`;

function emptyStats(fault: Pick<MockPaymentFault, "runId" | "delayMs" | "errorRate" | "timeoutRate" | "timeoutDelayMs">): MockFaultStats {
  return {
    runId: fault.runId,
    delayMs: fault.delayMs,
    errorRate: fault.errorRate,
    timeoutRate: fault.timeoutRate,
    timeoutDelayMs: fault.timeoutDelayMs,
    appliedCount: 0,
    delayedCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    firstAppliedAt: null,
    lastAppliedAt: null,
  };
}

export async function setMockPaymentFault(value: MockPaymentFault | null): Promise<void> {
  if (value) {
    await prisma.$transaction([
      prisma.systemState.upsert({
        where: { key: STATE_KEY },
        update: { valueJson: JSON.stringify(value) },
        create: { key: STATE_KEY, valueJson: JSON.stringify(value) },
      }),
      prisma.systemState.upsert({
        where: { key: statsKey(value.runId) },
        update: { valueJson: JSON.stringify(emptyStats(value)) },
        create: { key: statsKey(value.runId), valueJson: JSON.stringify(emptyStats(value)) },
      }),
    ]);
  } else {
    await prisma.systemState.deleteMany({ where: { key: STATE_KEY } });
  }
  cached = { value, until: Date.now() + 250 };
}

export async function getMockPaymentFault(): Promise<MockPaymentFault | null> {
  if (cached.until > Date.now()) return cached.value;
  const state = await prisma.systemState.findUnique({ where: { key: STATE_KEY } });
  let value: MockPaymentFault | null = null;
  if (state) {
    try {
      value = JSON.parse(state.valueJson) as MockPaymentFault;
      if (new Date(value.enabledUntil).getTime() <= Date.now()) value = null;
    } catch {
      value = null;
    }
  }
  cached = { value, until: Date.now() + 250 };
  return value;
}

export async function getMockPaymentFaultStats(runId: string): Promise<MockFaultStats | null> {
  const state = await prisma.systemState.findUnique({ where: { key: statsKey(runId) } });
  if (!state) return null;
  try {
    return JSON.parse(state.valueJson) as MockFaultStats;
  } catch {
    return null;
  }
}

function recordFault(fault: MockPaymentFault, properties: { delayed?: boolean; error?: boolean; timeout?: boolean }): void {
  const now = new Date().toISOString();
  const pending = pendingByRun.get(fault.runId) ?? emptyStats(fault);
  pending.appliedCount += 1;
  if (properties.delayed) pending.delayedCount += 1;
  if (properties.error) pending.errorCount += 1;
  if (properties.timeout) pending.timeoutCount += 1;
  pending.firstAppliedAt ??= now;
  pending.lastAppliedAt = now;
  pendingByRun.set(fault.runId, pending);
}

function mergePending(snapshot: PendingStats): void {
  const current = pendingByRun.get(snapshot.runId) ?? emptyStats(snapshot);
  current.appliedCount += snapshot.appliedCount;
  current.delayedCount += snapshot.delayedCount;
  current.errorCount += snapshot.errorCount;
  current.timeoutCount += snapshot.timeoutCount;
  current.firstAppliedAt = current.firstAppliedAt && snapshot.firstAppliedAt
    ? (current.firstAppliedAt < snapshot.firstAppliedAt ? current.firstAppliedAt : snapshot.firstAppliedAt)
    : current.firstAppliedAt ?? snapshot.firstAppliedAt;
  current.lastAppliedAt = current.lastAppliedAt && snapshot.lastAppliedAt
    ? (current.lastAppliedAt > snapshot.lastAppliedAt ? current.lastAppliedAt : snapshot.lastAppliedAt)
    : current.lastAppliedAt ?? snapshot.lastAppliedAt;
  pendingByRun.set(snapshot.runId, current);
}

/** Atomically adds one worker snapshot; PostgreSQL serializes concurrent row updates. */
export async function incrementMockPaymentFaultStats(snapshot: MockFaultStats): Promise<void> {
  const key = statsKey(snapshot.runId);
  const initial = JSON.stringify({ ...snapshot });
  await prisma.$executeRaw`
    INSERT INTO "SystemState" AS state (key, "valueJson", "updatedAt")
    VALUES (${key}, ${initial}, now())
    ON CONFLICT (key) DO UPDATE SET
      "valueJson" = jsonb_build_object(
        'runId', ${snapshot.runId},
        'delayMs', ${snapshot.delayMs},
        'errorRate', ${snapshot.errorRate},
        'timeoutRate', ${snapshot.timeoutRate},
        'timeoutDelayMs', ${snapshot.timeoutDelayMs},
        'appliedCount', COALESCE((state."valueJson"::jsonb ->> 'appliedCount')::bigint, 0) + ${snapshot.appliedCount},
        'delayedCount', COALESCE((state."valueJson"::jsonb ->> 'delayedCount')::bigint, 0) + ${snapshot.delayedCount},
        'errorCount', COALESCE((state."valueJson"::jsonb ->> 'errorCount')::bigint, 0) + ${snapshot.errorCount},
        'timeoutCount', COALESCE((state."valueJson"::jsonb ->> 'timeoutCount')::bigint, 0) + ${snapshot.timeoutCount},
        'firstAppliedAt', COALESCE(state."valueJson"::jsonb ->> 'firstAppliedAt', ${snapshot.firstAppliedAt}),
        'lastAppliedAt', ${snapshot.lastAppliedAt}
      )::text,
      "updatedAt" = now()
  `;
}

export function mockPaymentFaultStatsAreValid(stats: MockFaultStats | null): boolean {
  return Boolean(
    stats &&
    stats.appliedCount > 0 &&
    (stats.errorRate === 0 || stats.errorCount > 0) &&
    (stats.timeoutRate === 0 || stats.timeoutCount > 0)
  );
}

export async function flushMockPaymentFaultStats(force = false): Promise<void> {
  if (flushInFlight) return flushInFlight;
  if (!force && Date.now() - lastFlushAt < 1_000) return;
  if (pendingByRun.size === 0) return;
  lastFlushAt = Date.now();
  const snapshots = [...pendingByRun.values()];
  pendingByRun.clear();
  flushInFlight = (async () => {
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index];
      try {
        await incrementMockPaymentFaultStats(snapshot);
      } catch (error) {
        mergePending(snapshot);
        for (const unprocessed of snapshots.slice(index + 1)) mergePending(unprocessed);
        throw error;
      }
    }
  })();
  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

export async function applyMockPaymentFault(): Promise<void> {
  if (process.env.LOAD_TEST_MODE !== "true") return;
  const fault = await getMockPaymentFault();
  if (!fault) return;
  const sample = Math.random();
  if (sample < fault.timeoutRate) {
    recordFault(fault, { timeout: true });
    // The mock promise deliberately outlives PAYMENT_PROVIDER_TIMEOUT_MS.
    // Promise.race rejects in the worker while this call keeps running.
    await delay(fault.timeoutDelayMs);
    return;
  }
  const injectError = sample < fault.timeoutRate + fault.errorRate;
  recordFault(fault, { delayed: true, error: injectError });
  if (fault.delayMs > 0) await delay(fault.delayMs);
  if (injectError) throw new Error("Controlled mock provider error");
}
