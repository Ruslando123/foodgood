import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { isValidPilotInviteCode } from "@/lib/pilot-invite";
import { hasAcceptedCurrentPrivacyPolicy, PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { telegramAuthEnabled, verifyTelegramInitData } from "@/lib/telegram";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";

/** Авторизация из Telegram WebApp по initData. */
export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    if (!telegramAuthEnabled()) {
      throw new ApiError(503, "TELEGRAM_AUTH_DISABLED", "Вход через Telegram временно отключён");
    }
    await consumeRateLimit(`telegram:auth:${requestIp(req)}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    const { initData, inviteCode, privacyAccepted } = await readJsonObject(req);
    const tgUser = verifyTelegramInitData(String(initData ?? ""));
    if (!tgUser) {
      throw new ApiError(
        401,
        "INVALID_TELEGRAM_AUTH",
        "Telegram-авторизация недоступна или подпись неверна"
      );
    }

    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || null;
    const existing = await prisma.user.findUnique({
      where: { telegramId: String(tgUser.id) },
      select: { role: true, privacyPolicyVersion: true, privacyAcceptedAt: true },
    });
    if (!existing && !isValidPilotInviteCode(inviteCode)) {
      throw new ApiError(403, "PILOT_INVITE_REQUIRED", "Для входа в пилот нужен действующий код приглашения");
    }
    const needsPrivacyAcceptance = (existing?.role ?? "CUSTOMER") === "CUSTOMER"
      && !hasAcceptedCurrentPrivacyPolicy(existing ?? { privacyPolicyVersion: null, privacyAcceptedAt: null });
    if (needsPrivacyAcceptance && privacyAccepted !== true) {
      throw new ApiError(400, "PRIVACY_ACCEPTANCE_REQUIRED", "Нужно принять политику конфиденциальности");
    }
    const privacyData = privacyAccepted === true ? {
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      privacyAcceptedAt: new Date(),
    } : {};
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.upsert({
        where: { telegramId: String(tgUser.id) },
        update: { name, ...privacyData },
        create: { telegramId: String(tgUser.id), name, ...privacyData },
      });
      if (needsPrivacyAcceptance && privacyAccepted === true) {
        await tx.auditLog.create({
          data: {
            actorId: updated.id,
            action: "PRIVACY_POLICY_ACCEPTED",
            entityType: "User",
            entityId: updated.id,
            metadataJson: JSON.stringify({ version: PRIVACY_POLICY_VERSION, source: "telegram_login" }),
          },
        });
      }
      return updated;
    });
    if (user.status === "BLOCKED") {
      throw new ApiError(403, "ACCOUNT_BLOCKED", "Аккаунт заблокирован администратором");
    }
    await createSession(user.id);
    return json({
      ok: true,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    });
  });
}
