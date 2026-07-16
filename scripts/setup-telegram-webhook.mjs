const token = process.env.TELEGRAM_BOT_TOKEN;
const configuredUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");

if (!token || !configuredUsername || !secret || !baseUrl) {
  throw new Error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET and APP_BASE_URL");
}
if (!baseUrl.startsWith("https://")) {
  throw new Error("APP_BASE_URL must use HTTPS for a Telegram webhook");
}

const api = `https://api.telegram.org/bot${token}`;
const meResponse = await fetch(`${api}/getMe`);
const me = await meResponse.json();
if (!meResponse.ok || !me.ok || !me.result?.username) throw new Error("Telegram getMe failed");
if (me.result.username.toLowerCase() !== configuredUsername.toLowerCase()) {
  throw new Error(`TELEGRAM_BOT_USERNAME does not match @${me.result.username}`);
}

const response = await fetch(`${api}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${baseUrl}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
  }),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(`Telegram setWebhook failed: ${result.description ?? response.status}`);

console.log(`Webhook configured for @${me.result.username}: ${baseUrl}/api/telegram/webhook`);
