export class SmsConfigurationError extends Error {}

type MobizonResponse = {
  code?: number;
  message?: string;
  data?: { messageId?: number | string };
};

/** Sends OTP through the Kazakhstan Mobizon endpoint. */
export async function sendSmsCode(phone: string, code: string): Promise<void> {
  const apiKey = process.env.MOBIZON_API_KEY;
  if (!apiKey) throw new SmsConfigurationError("MOBIZON_API_KEY is not configured");

  const url = new URL("https://api.mobizon.kz/service/message/sendSmsMessage");
  url.searchParams.set("output", "json");
  url.searchParams.set("api", "v1");
  url.searchParams.set("apiKey", apiKey);
  const body = new URLSearchParams({
    recipient: phone.replace(/\D/g, ""),
    text: `FoodGood: ваш код входа ${code}. Никому его не сообщайте.`,
    "params[validity]": "60",
  });
  if (process.env.MOBIZON_SENDER) body.set("from", process.env.MOBIZON_SENDER);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as MobizonResponse | null;
  if (!response.ok || Number(payload?.code) !== 0 || !payload?.data?.messageId) {
    throw new Error(`Mobizon SMS failed (${response.status}): ${payload?.message ?? "invalid response"}`);
  }
}
