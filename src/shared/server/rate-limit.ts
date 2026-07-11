import { ApiError } from "@/shared/server/api";

type Bucket = { count: number; resetAt: number };

const globalBuckets = globalThis as unknown as { foodgoodRateLimits?: Map<string, Bucket> };
const buckets = globalBuckets.foodgoodRateLimits ?? new Map<string, Bucket>();
if (process.env.NODE_ENV !== "production") globalBuckets.foodgoodRateLimits = buckets;

export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** Локальный лимитер для MVP. В production его можно заменить Redis без изменения routes. */
export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number }
): void {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  if (current.count >= options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "Слишком много попыток. Попробуйте позже", {
      retryAfterSeconds,
    });
  }
  current.count += 1;
}
