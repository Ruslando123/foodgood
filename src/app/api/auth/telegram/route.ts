import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { verifyTelegramInitData } from "@/lib/telegram";

/** Авторизация из Telegram WebApp по initData. */
export async function POST(req: NextRequest) {
  const { initData } = await req.json().catch(() => ({}));
  const tgUser = verifyTelegramInitData(String(initData ?? ""));
  if (!tgUser) {
    return NextResponse.json(
      { error: "Telegram-авторизация недоступна или подпись неверна" },
      { status: 401 }
    );
  }

  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || null;
  const user = await prisma.user.upsert({
    where: { telegramId: String(tgUser.id) },
    update: { name },
    create: { telegramId: String(tgUser.id), name },
  });
  await createSession(user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
  });
}
