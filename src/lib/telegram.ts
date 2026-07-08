import { createHmac } from "crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export type TelegramInitUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

/**
 * Проверка initData из Telegram WebApp по алгоритму из документации:
 * hash = HMAC_SHA256(data_check_string, SHA256("WebAppData", bot_token)).
 * Возвращает пользователя Telegram или null, если подпись неверна
 * либо бот не сконфигурирован.
 */
export function verifyTelegramInitData(initData: string): TelegramInitUser | null {
  if (!BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computed !== hash) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (Date.now() / 1000 - authDate > 24 * 60 * 60) return null;

  try {
    return JSON.parse(params.get("user") ?? "") as TelegramInitUser;
  } catch {
    return null;
  }
}

/** Уведомление пользователю через бота; no-op, если токен не задан. */
export async function sendTelegramMessage(telegramId: string, text: string): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: "HTML" }),
    });
  } catch {
    // уведомления не критичны для флоу заказа
  }
}
