import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, normalizePhone } from "@/lib/auth";
import { consumeOtp, OtpError } from "@/lib/otp";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";
import { attachTelegramAfterOtp } from "@/lib/telegram-otp";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { TERMS_VERSION } from "@/lib/legal";

export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    const { phone, code, privacyAccepted, termsAccepted } = await readJsonObject(req);
    const normalized = normalizePhone(String(phone ?? ""));
    if (!normalized) {
      throw new ApiError(400, "INVALID_PHONE", "Некорректный номер телефона");
    }
    await consumeRateLimit(`otp:verify:${requestIp(req)}:${normalized}`, {
      limit: 8,
      windowMs: 15 * 60 * 1000,
    });
    const isAdminPhone = normalized === normalizePhone(process.env.ADMIN_PHONE ?? "");
    const existing = await prisma.user.findUnique({
      where: { phone: normalized },
      select: { role: true, status: true, privacyPolicyVersion: true, privacyAcceptedAt: true, termsVersion: true, termsAcceptedAt: true },
    });
    const needsPrivacyAcceptance = !isAdminPhone
      && (existing?.role ?? "CUSTOMER") === "CUSTOMER"
      && (existing?.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || existing.privacyAcceptedAt === null);
    if (needsPrivacyAcceptance && privacyAccepted !== true) {
      throw new ApiError(400, "PRIVACY_ACCEPTANCE_REQUIRED", "Нужно принять политику конфиденциальности");
    }
    const needsTermsAcceptance = !isAdminPhone
      && (existing?.role ?? "CUSTOMER") === "CUSTOMER"
      && (existing?.termsVersion !== TERMS_VERSION || existing.termsAcceptedAt === null);
    if (needsTermsAcceptance && termsAccepted !== true) {
      throw new ApiError(400, "TERMS_ACCEPTANCE_REQUIRED", "Нужно отдельно принять условия использования");
    }
    try {
      await consumeOtp(normalized, String(code ?? ""));
    } catch (error) {
      if (error instanceof OtpError) {
        throw new ApiError(error.code === "OTP_RATE_LIMITED" ? 429 : 401, error.code, error.message);
      }
      throw error;
    }

    // ADMIN_PHONE используется только для первичного создания администратора.
    // Роль существующего пользователя хранится в БД и не должна автоматически
    // возвращаться после явного назначения владельцем или покупателем.
    const privacyData = privacyAccepted === true ? {
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      privacyAcceptedAt: new Date(),
    } : {};
    const termsData = termsAccepted === true ? {
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: new Date(),
    } : {};
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.upsert({
        where: { phone: normalized },
        update: { ...privacyData, ...termsData },
        create: { phone: normalized, role: isAdminPhone ? "ADMIN" : "CUSTOMER", ...privacyData, ...termsData },
      });
      if (needsPrivacyAcceptance && privacyAccepted === true) {
        await tx.auditLog.create({
          data: {
            actorId: updated.id,
            action: "PRIVACY_POLICY_ACCEPTED",
            entityType: "User",
            entityId: updated.id,
            metadataJson: JSON.stringify({ version: PRIVACY_POLICY_VERSION, source: "phone_login", ip: requestIp(req), userAgent: req.headers.get("user-agent") }),
          },
        });
      }
      if (needsTermsAcceptance && termsAccepted === true) {
        await tx.auditLog.create({
          data: {
            actorId: updated.id,
            action: "TERMS_ACCEPTED",
            entityType: "User",
            entityId: updated.id,
            metadataJson: JSON.stringify({ version: TERMS_VERSION, source: "phone_login", ip: requestIp(req), userAgent: req.headers.get("user-agent") }),
          },
        });
      }
      return updated;
    });
    if (user.status === "BLOCKED") {
      throw new ApiError(403, "ACCOUNT_BLOCKED", "Аккаунт заблокирован администратором");
    }
    if (user.status === "DEACTIVATED") {
      throw new ApiError(403, "ACCOUNT_DEACTIVATED", "Аккаунт деактивирован. Для восстановления обратитесь в поддержку");
    }
    await attachTelegramAfterOtp(normalized, user.id);
    await createSession(user.id);
    return json({
      ok: true,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    });
  });
}
