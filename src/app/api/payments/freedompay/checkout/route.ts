import { randomBytes } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { freedomPayCardCheckout, getFreedomPayConfig } from "@/lib/freedompay";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return text("Требуется вход", 401);
  const paymentId = new URL(request.url).searchParams.get("payment");
  if (!paymentId || paymentId.length > 64) return text("Платёж не найден", 404);
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
  if (
    !payment ||
    payment.order.userId !== user.id ||
    payment.provider !== "freedompay" ||
    payment.order.status !== "PENDING_PAYMENT" ||
    payment.status !== "PENDING_HOLD" ||
    !payment.providerRef
  ) {
    return text("Платёж недоступен", 409);
  }
  const config = getFreedomPayConfig();
  if (!config) return text("Платежи временно недоступны", 503);
  const checkout = freedomPayCardCheckout(config, payment.providerRef);
  const nonce = randomBytes(18).toString("base64");
  const inputs = Object.entries(checkout.fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("");
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Переход к оплате</title></head><body><form id="payment" method="post" action="${escapeHtml(checkout.action)}">${inputs}<button type="submit">Перейти к безопасной оплате</button></form><script nonce="${nonce}">document.getElementById("payment").submit()</script></body></html>`;
  const formOrigin = new URL(checkout.action).origin;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": `default-src 'none'; form-action ${formOrigin}; script-src 'nonce-${nonce}'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}
