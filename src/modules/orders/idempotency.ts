import { ApiError } from "@/shared/server/api";

type Entry<T> = { fingerprint: string; promise: Promise<T>; expiresAt: number };

const globalStore = globalThis as unknown as {
  foodgoodOrderIdempotency?: Map<string, Entry<unknown>>;
};
const store = globalStore.foodgoodOrderIdempotency ?? new Map<string, Entry<unknown>>();
if (process.env.NODE_ENV !== "production") globalStore.foodgoodOrderIdempotency = store;

/**
 * Защита от повторного запроса в одном экземпляре приложения.
 * Публичная граница позволит заменить хранилище на Redis/БД перед multi-instance deploy.
 */
export function idempotentOrderRequest<T>(
  key: string,
  fingerprint: string,
  work: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key) as Entry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    if (existing.fingerprint !== fingerprint) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key уже использован с другими параметрами"
      );
    }
    return existing.promise;
  }

  const promise = work().catch((error) => {
    store.delete(key);
    throw error;
  });
  store.set(key, { fingerprint, promise, expiresAt: now + 10 * 60 * 1000 });
  return promise;
}
