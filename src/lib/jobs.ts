import { randomUUID } from "crypto";
import { prisma } from "./db";
import { queueRefund } from "./orders";

export type BatchQueue = "notifications" | "refunds";
type ClaimedJob = {
  id: string;
  queue: string;
  type: string;
  payloadJson: string;
  attempts: number;
};

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 8;

export async function enqueueBatchJob(input: {
  queue: BatchQueue;
  type: "FANOUT_NEW_BAG" | "REFUND_CANCELLED_BAG";
  payload: Record<string, unknown>;
  dedupeKey: string;
}): Promise<void> {
  await prisma.batchJob.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      queue: input.queue,
      type: input.type,
      payloadJson: JSON.stringify(input.payload),
      dedupeKey: input.dedupeKey,
    },
  });
}

async function claimJobs(queue: BatchQueue, limit: number, workerId: string): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>`
    WITH candidates AS (
      SELECT id
      FROM "BatchJob"
      WHERE queue = ${queue}
        AND status IN ('PENDING', 'RETRY', 'PROCESSING')
        AND "nextAttemptAt" <= now()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
      ORDER BY "nextAttemptAt", id
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "BatchJob" job
    SET status = 'PROCESSING',
        "leaseOwner" = ${workerId},
        "leaseExpiresAt" = now() + interval '60 seconds',
        attempts = attempts + 1,
        "updatedAt" = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.id, job.queue, job.type, job."payloadJson", job.attempts
  `;
}

export async function runBatchJobs(
  queue: BatchQueue,
  jobLimit = 20,
  batchSize = 100,
  workerId = randomUUID()
): Promise<number> {
  const jobs = await claimJobs(queue, jobLimit, workerId);
  let processed = 0;
  for (const job of jobs) {
    try {
      const done = await processJob(job, batchSize);
      await prisma.batchJob.updateMany({
        where: { id: job.id, leaseOwner: workerId, status: "PROCESSING" },
        data: done
          ? { status: "SUCCEEDED", leaseOwner: null, leaseExpiresAt: null, lastError: null }
          : { status: "PENDING", nextAttemptAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });
      processed += 1;
    } catch (error) {
      const failed = job.attempts >= MAX_ATTEMPTS;
      await prisma.batchJob.updateMany({
        where: { id: job.id, leaseOwner: workerId },
        data: {
          status: failed ? "FAILED" : "RETRY",
          nextAttemptAt: new Date(Date.now() + Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, job.attempts - 1))),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return processed;
}

async function processJob(job: ClaimedJob, batchSize: number): Promise<boolean> {
  const payload = JSON.parse(job.payloadJson) as { bagId?: string; cursor?: string };
  if (!payload.bagId) throw new Error("Batch job has no bagId");
  if (job.type === "FANOUT_NEW_BAG") return fanoutNewBag(job.id, payload.bagId, payload.cursor, batchSize);
  if (job.type === "REFUND_CANCELLED_BAG") return refundCancelledBag(payload.bagId, batchSize);
  throw new Error(`Unsupported batch job type: ${job.type}`);
}

async function fanoutNewBag(jobId: string, bagId: string, cursor: string | undefined, batchSize: number): Promise<boolean> {
  const bag = await prisma.bag.findUniqueOrThrow({ where: { id: bagId }, include: { venue: true } });
  const followers = await prisma.favorite.findMany({
    where: { venueId: bag.venueId, user: { notificationOffers: true } },
    orderBy: { id: "asc" },
    take: batchSize,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
  if (followers.length < batchSize) return true;
  await prisma.batchJob.update({
    where: { id: jobId },
    data: { payloadJson: JSON.stringify({ bagId, cursor: followers.at(-1)!.id }) },
  });
  return false;
}

async function refundCancelledBag(bagId: string, batchSize: number): Promise<boolean> {
  const bag = await prisma.bag.findUniqueOrThrow({ where: { id: bagId }, include: { venue: true } });
  const orders = await prisma.order.findMany({
    where: { bagId, status: { in: ["PAID", "READY_FOR_PICKUP"] } },
    orderBy: { id: "asc" },
    take: batchSize,
    select: { id: true },
  });
  for (const order of orders) {
    if (!(await queueRefund(order.id, "CANCELLED"))) continue;
    const details = await prisma.order.findUnique({
      where: { id: order.id },
      include: { user: true, payment: { include: { operations: { where: { type: "REFUND" }, take: 1 } } } },
    });
    const operation = details?.payment?.operations[0];
    if (details?.user.telegramId && operation) {
      await prisma.outboxMessage.upsert({
        where: { operationId_type: { operationId: operation.id, type: "TELEGRAM_BAG_CANCELLED" } },
        update: {},
        create: {
          operationId: operation.id,
          orderId: order.id,
          type: "TELEGRAM_BAG_CANCELLED",
          payloadJson: JSON.stringify({
            telegramId: details.user.telegramId,
            text: `😔 «${bag.venue.name}» отменил пакет «${bag.title}». Деньги вернутся на карту.`,
          }),
        },
      });
    }
  }
  return orders.length < batchSize;
}

export async function renewBatchJobLease(jobId: string, workerId: string): Promise<boolean> {
  const result = await prisma.batchJob.updateMany({
    where: { id: jobId, leaseOwner: workerId, status: "PROCESSING" },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return result.count === 1;
}
