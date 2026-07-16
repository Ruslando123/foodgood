import { api } from "./api";

type ClientEventName = "offer_view" | "reserve_started" | "pickup_code_opened";

function sessionValue(key: string, create: () => string): string {
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const value = create();
    sessionStorage.setItem(key, value);
    return value;
  } catch {
    return create();
  }
}

export function currentClientSource(): string {
  if (typeof window === "undefined") return "direct";
  const current = new URL(window.location.href);
  const campaign = current.searchParams.get("utm_source") || current.searchParams.get("source");
  if (campaign) {
    const source = `campaign:${campaign}`.slice(0, 120);
    try { sessionStorage.setItem("foodgood:client-source", source); } catch {}
    return source;
  }
  try {
    const stored = sessionStorage.getItem("foodgood:client-source");
    if (stored) return stored;
  } catch {}
  if (document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== window.location.origin) return `referral:${referrer.hostname}`.slice(0, 120);
    } catch {}
  }
  return "direct";
}

export function analyticsHeaders(): Record<string, string> {
  return typeof window === "undefined" ? {} : { "X-Client-Source": currentClientSource() };
}

export async function trackProductEvent(input: { name: ClientEventName; bagId?: string; orderId?: string; quantity?: number }): Promise<void> {
  if (typeof window === "undefined") return;
  const anonymousId = sessionValue("foodgood:analytics-session", () => crypto.randomUUID());
  const entityId = input.orderId ?? input.bagId ?? "unknown";
  const clientEventId = sessionValue(`foodgood:event:${input.name}:${entityId}`, () => crypto.randomUUID());
  await api("/api/analytics/events", {
    method: "POST",
    headers: analyticsHeaders(),
    body: JSON.stringify({ ...input, anonymousId, clientEventId }),
    keepalive: true,
  });
}
