import { NextRequest } from "next/server";
import { normalizePhone } from "@/lib/auth";
import { issueOtp, OtpError } from "@/lib/otp";
import { SmsConfigurationError } from "@/lib/sms";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";

/** Issues a durable, one-time OTP and delegates production delivery to SMS. */
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
      const issued = await issueOtp(normalized);
      return json({ ok: true, phone: normalized, ...issued });
    } catch (error) {
      if (error instanceof OtpError) throw new ApiError(429, error.code, error.message);
      if (error instanceof SmsConfigurationError) {
        throw new ApiError(503, "PHONE_AUTH_NOT_CONFIGURED", "Вход по телефону временно недоступен");
      }
      throw error;
    }
  });
}
