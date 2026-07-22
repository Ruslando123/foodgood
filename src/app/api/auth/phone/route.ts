import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isDevOtpEnabled, normalizePhone } from "@/lib/auth";
import { hasAcceptedCurrentPrivacyPolicy } from "@/lib/privacy";
import { hasAcceptedCurrentTerms } from "@/lib/legal";
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
    const existing = await prisma.user.findUnique({
      where: { phone: normalized },
      select: { id: true, role: true, status: true, privacyPolicyVersion: true, privacyAcceptedAt: true, termsVersion: true, termsAcceptedAt: true },
    });
    if (existing?.status === "DEACTIVATED") {
      throw new ApiError(403, "ACCOUNT_DEACTIVATED", "Аккаунт деактивирован. Для восстановления обратитесь в поддержку");
    }
    const isAdminPhone = normalized === normalizePhone(process.env.ADMIN_PHONE ?? "");
    try {
      const issued = isDevOtpEnabled()
        ? await issueOtp(normalized)
        : await createTelegramOtpRequest(normalized);
      const privacyAcceptanceRequired = !isAdminPhone
        && (existing?.role ?? "CUSTOMER") === "CUSTOMER"
        && !hasAcceptedCurrentPrivacyPolicy(existing ?? { privacyPolicyVersion: null, privacyAcceptedAt: null });
      const termsAcceptanceRequired = !isAdminPhone
        && (existing?.role ?? "CUSTOMER") === "CUSTOMER"
        && !hasAcceptedCurrentTerms(existing ?? { termsVersion: null, termsAcceptedAt: null });
      return json({
        ok: true,
        phone: normalized,
        ownerPasswordless: existing?.role === "MERCHANT" && !isDevOtpEnabled(),
        privacyAcceptanceRequired,
        termsAcceptanceRequired,
        legalAcceptanceRequired: { privacy: privacyAcceptanceRequired, terms: termsAcceptanceRequired },
        ...issued,
      });
    } catch (error) {
      if (error instanceof OtpError) throw new ApiError(429, error.code, error.message);
      if (error instanceof Error && error.message.includes("Telegram OTP")) {
        throw new ApiError(503, "TELEGRAM_OTP_NOT_CONFIGURED", "Получение кода через Telegram временно недоступно");
      }
      throw error;
    }
  });
}
