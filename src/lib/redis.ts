import Redis from "ioredis";

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
