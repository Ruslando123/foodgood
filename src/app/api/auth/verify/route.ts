import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, normalizePhone } from "@/lib/auth";
import { consumeOtp, OtpError } from "@/lib/otp";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";
import { attachTelegramAfterOtp } from "@/lib/telegram-otp";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";

export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    const { phone, code, privacyAccepted } = await readJsonObject(req);
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
      select: { role: true, privacyPolicyVersion: true, privacyAcceptedAt: true },
    });
    const needsPrivacyAcceptance = !isAdminPhone
      && (existing?.role ?? "CUSTOMER") === "CUSTOMER"
      && (existing?.privacyPolicyVersion !== PRIVACY_POLICY_VERSION || existing.privacyAcceptedAt === null);
    if (needsPrivacyAcceptance && privacyAccepted !== true) {
      throw new ApiError(400, "PRIVACY_ACCEPTANCE_REQUIRED", "Нужно принять политику конфиденциальности");
    }
    try {
      await consumeOtp(normalized, String(code ?? ""));
    } catch (error) {
      if (error instanceof OtpError) {
        throw new ApiError(error.code === "OTP_RATE_LIMITED" ? 429 : 401, error.code, error.message);
      }
      throw error;
    }

    // Номер администратора хранится вне кода. Это позволяет выдать доступ
    // конкретному владельцу проекта без отдельной формы регистрации.
    const privacyData = privacyAccepted === true ? {
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      privacyAcceptedAt: new Date(),
    } : {};
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.upsert({
        where: { phone: normalized },
        update: { ...(isAdminPhone ? { role: "ADMIN" } : {}), ...privacyData },
        create: { phone: normalized, role: isAdminPhone ? "ADMIN" : "CUSTOMER", ...privacyData },
      });
      if (needsPrivacyAcceptance && privacyAccepted === true) {
        await tx.auditLog.create({
          data: {
            actorId: updated.id,
            action: "PRIVACY_POLICY_ACCEPTED",
            entityType: "User",
            entityId: updated.id,
            metadataJson: JSON.stringify({ version: PRIVACY_POLICY_VERSION, source: "phone_login" }),
          },
        });
      }
      return updated;
    });
    if (user.status === "BLOCKED") {
      throw new ApiError(403, "ACCOUNT_BLOCKED", "Аккаунт заблокирован администратором");
    }
    await attachTelegramAfterOtp(normalized, user.id);
    await createSession(user.id);
    return json({
      ok: true,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    });
  });
}
