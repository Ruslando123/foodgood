import { NextRequest } from "next/server";
import { isDevOtpEnabled, normalizePhone } from "@/lib/auth";
import { issueOtp, OtpError } from "@/lib/otp";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";
import { createTelegramOtpRequest } from "@/lib/telegram-otp";

/** Creates a Telegram handoff; local development keeps the guarded demo OTP. */
export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    const { phone } = await readJsonObject(req);
    const normalized = normalizePhone(String(phone ?? ""));
    if (!normalized) {
      throw new ApiError(400, "INVALID_PHONE", "Некорректный номер телефона");
    }
    await consumeRateLimit(`otp:request:${requestIp(req)}:${normalized}`, {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    try {
      const issued = isDevOtpEnabled()
        ? await issueOtp(normalized)
        : await createTelegramOtpRequest(normalized);
      return json({ ok: true, phone: normalized, ...issued });
    } catch (error) {
      if (error instanceof OtpError) throw new ApiError(429, error.code, error.message);
      if (error instanceof Error && error.message.includes("Telegram OTP")) {
        throw new ApiError(503, "TELEGRAM_OTP_NOT_CONFIGURED", "Получение кода через Telegram временно недоступно");
      }
      throw error;
    }
  });
}
