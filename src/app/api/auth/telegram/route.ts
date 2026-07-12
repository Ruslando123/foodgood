import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { telegramAuthEnabled, verifyTelegramInitData } from "@/lib/telegram";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";

/** Авторизация из Telegram WebApp по initData. */
export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    if (!telegramAuthEnabled()) {
      throw new ApiError(503, "TELEGRAM_AUTH_DISABLED", "Вход через Telegram временно отключён");
    }
    await consumeRateLimit(`telegram:auth:${requestIp(req)}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    const { initData } = await readJsonObject(req);
    const tgUser = verifyTelegramInitData(String(initData ?? ""));
    if (!tgUser) {
      throw new ApiError(
        401,
        "INVALID_TELEGRAM_AUTH",
        "Telegram-авторизация недоступна или подпись неверна"
      );
    }

    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || null;
    const user = await prisma.user.upsert({
      where: { telegramId: String(tgUser.id) },
      update: { name },
      create: { telegramId: String(tgUser.id), name },
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
