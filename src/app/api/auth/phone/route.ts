import { NextRequest } from "next/server";
import { isDevOtpEnabled, normalizePhone } from "@/lib/auth";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";

/**
 * Запрос кода подтверждения. В MVP SMS не отправляется — код всегда 0000.
 * Здесь же в продакшене подключается SMS-шлюз.
 */
export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    if (!isDevOtpEnabled()) {
      throw new ApiError(
        503,
        "PHONE_AUTH_NOT_CONFIGURED",
        "Вход по телефону временно недоступен"
      );
    }
    const { phone } = await readJsonObject(req);
    const normalized = normalizePhone(String(phone ?? ""));
    if (!normalized) {
      throw new ApiError(400, "INVALID_PHONE", "Некорректный номер телефона");
    }
    consumeRateLimit(`otp:request:${requestIp(req)}:${normalized}`, {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    return json({ ok: true, phone: normalized });
  });
}
