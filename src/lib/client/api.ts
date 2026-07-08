// Типы API-ответов и хелперы для клиентских компонентов

export type Venue = {
  id: string;
  name: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  category: string;
  photo: string;
};

export type Bag = {
  id: string;
  venueId: string;
  title: string;
  description: string;
  price: number;
  originalPrice: number;
  quantityTotal: number;
  quantityLeft: number;
  pickupStart: string;
  pickupEnd: string;
  status: string;
  venue: Venue;
  distanceKm?: number | null;
};

export type Payment = {
  id: string;
  status: "HELD" | "CAPTURED" | "REFUNDED";
};

export type Order = {
  id: string;
  quantity: number;
  totalPrice: number;
  platformFee: number;
  status: "PENDING_PAYMENT" | "PAID" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  pickupCode: string;
  createdAt: string;
  bag: Bag;
  payment?: Payment | null;
};

export type SessionUser = {
  id: string;
  phone: string | null;
  name: string | null;
  role: string;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка запроса (${res.status})`);
  return data as T;
}

export function formatPrice(kzt: number): string {
  return `${kzt.toLocaleString("ru-RU")} ₸`;
}

export function formatPickupWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const start = new Date(startIso);
  const today = new Date();
  const dayLabel =
    start.toDateString() === today.toDateString()
      ? "сегодня"
      : start.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return `${dayLabel} ${fmt(startIso)}–${fmt(endIso)}`;
}

export function discountPct(bag: Pick<Bag, "price" | "originalPrice">): number {
  if (bag.originalPrice <= 0) return 0;
  return Math.round((1 - bag.price / bag.originalPrice) * 100);
}
