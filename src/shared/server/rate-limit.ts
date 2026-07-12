import { ApiError } from "@/shared/server/api";
import { prisma } from "@/lib/db";
import { redisReady } from "@/lib/redis";

export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** Локальный лимитер для MVP. В production его можно заменить Redis без изменения routes. */
export async function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number }
): Promise<void> {
  const redis = await redisReady();
  if (redis) {
    try {
      const redisKey = `rate-limit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.pexpire(redisKey, options.windowMs);
      if (count > options.limit) {
        const ttl = await redis.pttl(redisKey);
        throw new ApiError(429, "RATE_LIMITED", "Слишком много попыток. Попробуйте позже", {
          retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
        });
      }
      return;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // PostgreSQL is the safe fallback during a Redis outage.
    }
  }
  const now = new Date();
  const nextReset = new Date(now.getTime() + options.windowMs);
  const [bucket] = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${nextReset}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${nextReset}
        ELSE "RateLimitBucket"."resetAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "resetAt"
  `;
  if (bucket.count > options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "Слишком много попыток. Попробуйте позже", {
      retryAfterSeconds,
    });
  }
}

export async function pruneExpiredRateLimits(): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({
    where: { resetAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
}
