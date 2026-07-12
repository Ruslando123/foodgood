export class SmsConfigurationError extends Error {}

/** Provider-neutral boundary for an adapter to the chosen SMS vendor. */
export async function sendSmsCode(phone: string, code: string): Promise<void> {
  const url = process.env.SMS_WEBHOOK_URL;
  const token = process.env.SMS_WEBHOOK_TOKEN;
  if (!url || !token) throw new SmsConfigurationError("SMS provider is not configured");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "OTP", phone, code }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`SMS provider failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
}
