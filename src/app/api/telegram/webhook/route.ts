import { NextRequest } from "next/server";
import { telegramOtpEnabled } from "@/lib/telegram";
import {
  processTelegramWebhook,
  type TelegramWebhookUpdate,
  verifyTelegramWebhookSecret,
} from "@/lib/telegram-otp";

export async function POST(req: NextRequest) {
  if (!telegramOtpEnabled()) return new Response(null, { status: 404 });
  if (!verifyTelegramWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response(null, { status: 401 });
  }
  const update = await req.json().catch(() => null) as TelegramWebhookUpdate | null;
  if (!update) return new Response(null, { status: 400 });
  await processTelegramWebhook(update);
  return Response.json({ ok: true });
}
