import Redis from "ioredis";
import { redisAvailable, redisConfigured } from "./metrics";

const globalRedis = globalThis as unknown as { foodgoodRedis?: Redis };

export function redisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!globalRedis.foodgoodRedis) {
    globalRedis.foodgoodRedis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
    });
    globalRedis.foodgoodRedis.on("error", () => undefined);
  }
  return globalRedis.foodgoodRedis;
}

export async function redisReady(): Promise<Redis | null> {
  const redis = redisClient();
  if (!redis) return null;
  try {
    if (redis.status === "wait") await redis.connect();
    if (redis.status !== "ready") return null;
    return redis;
  } catch {
    return null;
  }
}

export type RedisHealth = "disabled" | "ok" | "unavailable";

/** Active, bounded Redis check used by deep health and the metrics scrape. */
export async function checkRedisHealth(): Promise<RedisHealth> {
  if (!process.env.REDIS_URL) {
    redisConfigured.set(0);
    redisAvailable.set(0);
    return "disabled";
  }
  redisConfigured.set(1);
  const redis = await redisReady();
  if (!redis) {
    redisAvailable.set(0);
    return "unavailable";
  }
  try {
    await redis.ping();
    redisAvailable.set(1);
    return "ok";
  } catch {
    redisAvailable.set(0);
    return "unavailable";
  }
}
