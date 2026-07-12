import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/shared/server/api";

const TTL_MS = 10 * 60_000;
const WAIT_MS = 5_000;
const POLL_MS = 25;

function keyConflict(): never {
  throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key уже использован с другими параметрами");
}

/**
 * Database-backed idempotency for order creation.  Only the instance that
 * inserts (or atomically reclaims) PROCESSING runs `work`; other instances
 * wait for its persisted result. Failed work is deliberately reclaimable with
 * the same key, making a client retry safe without an in-memory lock.
 */
export async function idempotentOrderRequest<T>(
  key: string,
  fingerprint: string,
  work: (idempotencyRecordId: string) => Promise<T>
): Promise<T> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  // TTL is also cleanup. Never delete a PROCESSING row here: another instance
  // must first atomically reclaim it below, otherwise an in-flight request
  // could lose its uniqueness fence.
  await prisma.orderIdempotencyKey.deleteMany({
    where: { expiresAt: { lt: now }, status: { in: ["SUCCEEDED", "FAILED"] } },
  });

  let owner = false;
  let ownerId: string | null = null;
  try {
    const created = await prisma.orderIdempotencyKey.create({
      data: { key, fingerprint, status: "PROCESSING", expiresAt },
    });
    owner = true;
    ownerId = created.id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }

  while (!owner) {
    const entry = await prisma.orderIdempotencyKey.findUnique({ where: { key } });
    if (!entry) {
      // A concurrent TTL cleanup won the race. Retry acquisition once through
      // the normal path rather than ever falling back to process memory.
      return idempotentOrderRequest(key, fingerprint, work);
    }
    if (entry.fingerprint !== fingerprint) keyConflict();
    if (entry.status === "SUCCEEDED" && entry.resultJson) return JSON.parse(entry.resultJson) as T;
    if (entry.status === "FAILED" || entry.expiresAt <= new Date()) {
      const claimed = await prisma.orderIdempotencyKey.updateMany({
        where: {
          id: entry.id,
          fingerprint,
          OR: [{ status: "FAILED" }, { expiresAt: { lte: new Date() } }],
        },
        data: { status: "PROCESSING", resultJson: null, expiresAt },
      });
      if (claimed.count) {
        owner = true;
        ownerId = entry.id;
      }
      continue;
    }

    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const completed = await prisma.orderIdempotencyKey.findUnique({ where: { key } });
      if (!completed) break;
      if (completed.fingerprint !== fingerprint) keyConflict();
      if (completed.status === "SUCCEEDED" && completed.resultJson) {
        return JSON.parse(completed.resultJson) as T;
      }
      if (completed.status === "FAILED" || completed.expiresAt <= new Date()) break;
    }
    // Re-read/reclaim on the next outer loop. A long-running request gets a
    // deterministic 409 instead of a duplicate order if it is still active.
    const latest = await prisma.orderIdempotencyKey.findUnique({ where: { key } });
    if (latest?.status === "PROCESSING" && latest.expiresAt > new Date()) {
      throw new ApiError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "Такой запрос ещё обрабатывается; повторите его тем же ключом");
    }
  }

  if (!ownerId) throw new Error("Idempotency ownership was not acquired");
  try {
    const result = await work(ownerId);
    await prisma.orderIdempotencyKey.update({
      where: { key },
      data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), expiresAt },
    });
    return result;
  } catch (error) {
    await prisma.orderIdempotencyKey.updateMany({
      where: { key, status: "PROCESSING" },
      data: { status: "FAILED" },
    });
    throw error;
  }
}
