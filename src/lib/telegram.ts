import { createHmac } from "crypto";

// Читаем лениво: env может подгружаться после импорта модуля (тесты, next dev)
const botToken = () => process.env.TELEGRAM_BOT_TOKEN;

export function telegramAuthEnabled(): boolean {
  return process.env.TELEGRAM_AUTH_ENABLED === "true" && Boolean(botToken());
}

export function telegramNotificationsEnabled(): boolean {
  return process.env.TELEGRAM_NOTIFICATIONS_ENABLED === "true" && Boolean(botToken());
}

export function telegramOtpEnabled(): boolean {
  return process.env.TELEGRAM_OTP_ENABLED === "true"
    && Boolean(botToken())
    && Boolean(process.env.TELEGRAM_BOT_USERNAME)
    && Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);
}

export function telegramBotUsername(): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return username || null;
}

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
  const token = botToken();
  if (!token) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
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

export async function sendTelegramBotMessage(
  telegramId: string,
  text: string,
  options: { replyMarkup?: Record<string, unknown> } = {}
): Promise<void> {
  const token = botToken();
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    }
    return;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegramId,
      text,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
}

/** Уведомление пользователю через бота; no-op, если токен не задан. */
export async function sendTelegramMessage(telegramId: string, text: string): Promise<void> {
  return sendTelegramBotMessage(telegramId, text);
}
