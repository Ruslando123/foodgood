import { randomUUID } from "crypto";
import { prisma } from "./db";
import { PRIVACY_POLICY_VERSION } from "./privacy";
import { startLeaseHeartbeat } from "./lease-heartbeat";
import { workerClaims, workerFailures, workerJobDuration, workerLeaseLost, workerSuccesses } from "./metrics";
import { PILOT_CATEGORY_ALLOWLIST } from "./config";

export type BatchQueue = "notifications";
type BatchJobType = "FANOUT_NEW_BAG" | "PICKUP_REMINDER";
type ClaimedJob = {
  id: string;
  queue: string;
  type: BatchJobType;
  payloadJson: string;
  failureAttempts: number;
};
type JobResult = { done: boolean; payloadJson?: string };

const LEASE_MS = 60_000;
const MAX_FAILURE_ATTEMPTS = 8;
const JOB_CONCURRENCY = 5;

export async function enqueueBatchJob(input: {
  queue: BatchQueue;
  type: BatchJobType;
  payload: Record<string, unknown>;
  dedupeKey: string;
  nextAttemptAt?: Date;
}): Promise<void> {
  await prisma.batchJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      queue: input.queue,
      type: input.type,
      payloadJson: JSON.stringify(input.payload),
      dedupeKey: input.dedupeKey,
      nextAttemptAt: input.nextAttemptAt ?? new Date(0),
    },
  });
}

async function claimJob(queue: BatchQueue, leaseToken: string): Promise<ClaimedJob | null> {
  const [job] = await prisma.$queryRaw<ClaimedJob[]>`
    WITH candidates AS (
      SELECT id
      FROM "BatchJob"
      WHERE queue = ${queue}
        AND status IN ('PENDING', 'RETRY', 'PROCESSING')
        AND "nextAttemptAt" <= now()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "nextAttemptAt", id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "BatchJob" job
    SET status = 'PROCESSING',
        "leaseOwner" = ${leaseToken},
        "leaseExpiresAt" = now() + interval '60 seconds',
        "updatedAt" = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.id, job.queue, job.type, job."payloadJson", job."failureAttempts"
  `;
  return job ?? null;
}

export async function runBatchJobs(
  queue: BatchQueue,
  jobLimit = 20,
  batchSize = 100,
  processWorkerId = randomUUID()
): Promise<number> {
  let claimed = 0;
  let processed = 0;
  const workers = Array.from({ length: Math.min(JOB_CONCURRENCY, jobLimit) }, async () => {
    while (claimed < jobLimit) {
      claimed += 1;
      const leaseToken = `${processWorkerId}:${randomUUID()}`;
      const job = await claimJob(queue, leaseToken);
      if (!job) return;
      workerClaims.inc({ worker: queue });
      if (await processClaimedJob(job, batchSize, leaseToken)) processed += 1;
    }
  });
  await Promise.all(workers);
  return processed;
}

class BatchJobLeaseLostError extends Error {}

async function renewJobLease(id: string, leaseToken: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "BatchJob"
    SET "leaseExpiresAt" = now() + interval '60 seconds', "updatedAt" = now()
    WHERE id = ${id} AND status = 'PROCESSING'
      AND "leaseOwner" = ${leaseToken} AND "leaseExpiresAt" > now()
    RETURNING id
  `;
  return rows.length === 1;
}

async function processClaimedJob(job: ClaimedJob, batchSize: number, leaseToken: string): Promise<boolean> {
  const startedAt = performance.now();
  const heartbeat = startLeaseHeartbeat(
    () => renewJobLease(job.id, leaseToken),
    LEASE_MS / 3
  );
  try {
    const result = await processJob(job, batchSize);
    if (heartbeat.lost()) throw new BatchJobLeaseLostError("Batch job lease was lost during processing");
    const payloadJson = result.payloadJson ?? job.payloadJson;
    const updated = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "BatchJob"
      SET status = ${result.done ? "SUCCEEDED" : "PENDING"},
          "nextAttemptAt" = CASE WHEN ${result.done} THEN "nextAttemptAt" ELSE now() END,
          "payloadJson" = ${payloadJson}, "failureAttempts" = 0,
          "batchesProcessed" = "batchesProcessed" + 1,
          "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL,
          "updatedAt" = now()
      WHERE id = ${job.id} AND status = 'PROCESSING'
        AND "leaseOwner" = ${leaseToken} AND "leaseExpiresAt" > now()
      RETURNING id
    `;
    const succeeded = updated.length === 1;
    if (succeeded) workerSuccesses.inc({ worker: job.queue });
    workerJobDuration.observe({ worker: job.queue, result: succeeded ? "success" : "fenced" }, (performance.now() - startedAt) / 1000);
    return succeeded;
  } catch (error) {
    if (error instanceof BatchJobLeaseLostError || heartbeat.lost()) {
      workerLeaseLost.inc({ worker: job.queue });
      workerJobDuration.observe({ worker: job.queue, result: "lease_lost" }, (performance.now() - startedAt) / 1000);
      return false;
    }
    const nextFailureAttempt = job.failureAttempts + 1;
    const failed = nextFailureAttempt >= MAX_FAILURE_ATTEMPTS;
    const delaySeconds = Math.round(Math.min(15 * 60, 5 * 2 ** Math.max(0, nextFailureAttempt - 1)));
    const errorMessage = error instanceof Error ? error.message : String(error);
    const updated = await prisma.$executeRaw`
      UPDATE "BatchJob"
      SET "failureAttempts" = "failureAttempts" + 1,
          status = ${failed ? "FAILED" : "RETRY"},
          "nextAttemptAt" = now() + (${delaySeconds} * interval '1 second'),
          "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "lastError" = ${errorMessage},
          "updatedAt" = now()
      WHERE id = ${job.id} AND status = 'PROCESSING'
        AND "leaseOwner" = ${leaseToken} AND "leaseExpiresAt" > now()
    `;
    if (updated) workerFailures.inc({ worker: job.queue });
    workerJobDuration.observe({ worker: job.queue, result: failed ? "failed" : "retry" }, (performance.now() - startedAt) / 1000);
    return false;
  } finally {
    await heartbeat.stop();
  }
}

async function processJob(job: ClaimedJob, batchSize: number): Promise<JobResult> {
  const payload = JSON.parse(job.payloadJson) as { bagId?: string; cursor?: string; orderId?: string };
  if (job.type === "PICKUP_REMINDER") {
    if (!payload.orderId) throw new Error("Pickup reminder job has no orderId");
    return pickupReminder(payload.orderId);
  }
  if (!payload.bagId) throw new Error("Batch job has no bagId");
  if (job.type === "FANOUT_NEW_BAG") return fanoutNewBag(payload.bagId, payload.cursor, batchSize);
  throw new Error(`Unsupported batch job type: ${job.type}`);
}

async function pickupReminder(orderId: string): Promise<JobResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, bag: { include: { venue: true } } },
  });
  if (!order || !order.user.notificationReminders || !["RESERVED", "READY_FOR_PICKUP"].includes(order.status) || order.bag.pickupEnd <= new Date()) {
    return { done: true };
  }
  await prisma.notification.createMany({
    data: [{
      userId: order.userId,
      channel: "IN_APP",
      recipient: order.userId,
      type: "PICKUP_REMINDER",
      status: "SENT",
      sentAt: new Date(),
      dedupeKey: `pickup-reminder:${order.id}`,
      payloadJson: JSON.stringify({ orderId: order.id, venueName: order.bag.venue.name, title: order.bag.title, pickupStart: order.bag.pickupStart }),
    }],
    skipDuplicates: true,
  });
  return { done: true };
}

async function fanoutNewBag(bagId: string, cursor: string | undefined, batchSize: number): Promise<JobResult> {
  const bag = await prisma.bag.findFirst({
    where: {
      id: bagId,
      status: "ACTIVE",
      pickupEnd: { gt: new Date() },
      suitableForSaleAttested: true,
      storageCompliantAttested: true,
      allergensCurrentAttested: true,
      categoryAllowedAttested: true,
      venue: {
        status: "ACTIVE",
        category: { in: [...PILOT_CATEGORY_ALLOWLIST] },
      },
    },
    include: { venue: true },
  });
  if (!bag) return { done: true };
  const followers = await prisma.favorite.findMany({
    where: {
      venueId: bag.venueId,
      user: {
        notificationOffers: true,
        communicationsConsent: true,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        privacyAcceptedAt: { not: null },
      },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: batchSize,
    select: { id: true, userId: true },
  });
  if (followers.length) {
    await prisma.notification.createMany({
      data: followers.map(({ userId }) => ({
        userId,
        channel: "IN_APP",
        recipient: userId,
        type: "NEW_FAVORITE_VENUE_BAG",
        status: "SENT",
        sentAt: new Date(),
        dedupeKey: `new-bag:${bag.id}:${userId}`,
        payloadJson: JSON.stringify({ bagId: bag.id, venueId: bag.venueId, venueName: bag.venue.name, title: bag.title }),
      })),
      skipDuplicates: true,
    });
  }
  return followers.length < batchSize
    ? { done: true }
    : { done: false, payloadJson: JSON.stringify({ bagId, cursor: followers.at(-1)!.id }) };
}
