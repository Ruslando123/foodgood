import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/shared/server/api";
import { redisReady } from "@/lib/redis";
import { randomUUID } from "crypto";

const PROCESSING_TTL_MS = 60_000;
const RESULT_TTL_MS = 24 * 60 * 60_000;
const REDIS_CACHE_TTL_MS = 10 * 60_000;
const WAIT_MS = 5_000;
const MIN_POLL_MS = 50;
const MAX_POLL_MS = 500;

function keyConflict(): never {
  throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key уже использован с другими параметрами");
}

export function normalizeIdempotencyKey(raw: string | null): string {
  const key = raw?.trim();
  if (!key) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Для создания заказа требуется Idempotency-Key");
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Некорректный Idempotency-Key");
  }
  return key;
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
  work: (idempotencyRecordId: string, ownerToken: string) => Promise<T>
): Promise<T> {
  const redis = await redisReady();
  const cacheKey = `idempotency:order:${key}`;
  if (redis) {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      const value = JSON.parse(cached) as { fingerprint: string; result: T };
      if (value.fingerprint !== fingerprint) keyConflict();
      return value.result;
    }
  }
  const now = new Date();
  const processingExpiresAt = new Date(now.getTime() + PROCESSING_TTL_MS);

  let owner = false;
  let ownerId: string | null = null;
  let ownerToken = randomUUID();
  try {
    const created = await prisma.orderIdempotencyKey.create({
      data: { key, fingerprint, ownerToken, status: "PROCESSING", expiresAt: processingExpiresAt },
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
    if (entry.status === "SUCCEEDED" && entry.resultJson) {
      const result = JSON.parse(entry.resultJson) as T;
      if (redis) await redis.set(cacheKey, JSON.stringify({ fingerprint, result }), "PX", REDIS_CACHE_TTL_MS).catch(() => undefined);
      return result;
    }
    if (entry.status === "FAILED" || entry.expiresAt <= new Date()) {
      const nextOwnerToken = randomUUID();
      const claimed = await prisma.orderIdempotencyKey.updateMany({
        where: {
          id: entry.id,
          fingerprint,
          OR: [{ status: "FAILED" }, { expiresAt: { lte: new Date() } }],
        },
        data: { ownerToken: nextOwnerToken, status: "PROCESSING", resultJson: null, expiresAt: new Date(Date.now() + PROCESSING_TTL_MS) },
      });
      if (claimed.count) {
        owner = true;
        ownerId = entry.id;
        ownerToken = nextOwnerToken;
      }
      continue;
    }

    const deadline = Date.now() + WAIT_MS;
    let pollMs = MIN_POLL_MS;
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const jitteredMs = Math.round(pollMs * (0.8 + Math.random() * 0.4));
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(remainingMs, jitteredMs))));
      pollMs = Math.min(MAX_POLL_MS, pollMs * 2);
      const completed = await prisma.orderIdempotencyKey.findUnique({ where: { key } });
      if (!completed) break;
      if (completed.fingerprint !== fingerprint) keyConflict();
      if (completed.status === "SUCCEEDED" && completed.resultJson) {
        const result = JSON.parse(completed.resultJson) as T;
        if (redis) await redis.set(cacheKey, JSON.stringify({ fingerprint, result }), "PX", REDIS_CACHE_TTL_MS).catch(() => undefined);
        return result;
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
    const result = await work(ownerId, ownerToken);
    const resultExpiresAt = resultRetentionExpiry(result);
    const completed = await prisma.orderIdempotencyKey.updateMany({
      where: { id: ownerId, ownerToken, status: "PROCESSING" },
      data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), expiresAt: resultExpiresAt },
    });
    if (completed.count !== 1) {
      throw new ApiError(409, "IDEMPOTENCY_OWNERSHIP_LOST", "Запрос был безопасно перехвачен повторной попыткой");
    }
    if (redis) await redis.set(cacheKey, JSON.stringify({ fingerprint, result }), "PX", REDIS_CACHE_TTL_MS).catch(() => undefined);
    return result;
  } catch (error) {
    await prisma.orderIdempotencyKey.updateMany({
      where: { id: ownerId, ownerToken, status: "PROCESSING" },
      data: { status: "FAILED" },
    });
    throw error;
  }
}

/**
 * Keep an order's dedupe record through its pickup window. A delayed mobile
 * retry must never create a second reservation merely because 24 hours passed.
 */
function resultRetentionExpiry(result: unknown): Date {
  const fallback = Date.now() + RESULT_TTL_MS;
  if (!result || typeof result !== "object" || !("bag" in result)) return new Date(fallback);
  const bag = (result as { bag?: unknown }).bag;
  if (!bag || typeof bag !== "object" || !("pickupEnd" in bag)) return new Date(fallback);
  const pickupEnd = new Date((bag as { pickupEnd: string | Date }).pickupEnd).getTime();
  return new Date(Number.isFinite(pickupEnd) ? Math.max(fallback, pickupEnd + RESULT_TTL_MS) : fallback);
}

export async function pruneExpiredOrderIdempotencyKeys(limit = 500): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidates AS (
      SELECT id FROM "OrderIdempotencyKey"
      WHERE "expiresAt" < now() AND status IN ('SUCCEEDED', 'FAILED')
      ORDER BY "expiresAt", id FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    DELETE FROM "OrderIdempotencyKey" entry
    USING candidates WHERE entry.id = candidates.id
    RETURNING entry.id
  `;
  return rows.length;
}
