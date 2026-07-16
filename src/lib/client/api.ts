// Типы API-ответов и хелперы для клиентских компонентов

export type Venue = {
  id: string;
  name: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  cityId: string;
  twoGisUrl: string;
  category: string;
  photo: string;
  rating?: number | null;
  reviewCount?: number;
  reviews?: Array<{ id: string; rating: number; comment: string; createdAt: string; user: { name: string | null } }>;
};

export type Bag = {
  id: string;
  venueId: string;
  title: string;
  description: string;
  allergens: string;
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
  status: "PENDING_HOLD" | "HELD" | "CAPTURED" | "REFUNDED" | "FAILED";
  checkoutUrl?: string;
};

export type PaymentMode = "ONLINE" | "PAY_AT_PICKUP";

export type Order = {
  id: string;
  quantity: number;
  totalPrice: number;
  platformFee: number;
  paymentMethod: PaymentMode;
  status:
    | "RESERVED"
    | "PENDING_PAYMENT"
    | "PAID"
    | "READY_FOR_PICKUP"
    | "CAPTURE_PENDING"
    | "COMPLETED"
    | "REFUND_PENDING"
    | "CANCELLED"
    | "EXPIRED";
  pickupCode: string;
  createdAt: string;
  bag: Bag;
  payment?: Payment | null;
  review?: { id: string; rating: number; comment: string } | null;
};

export type SessionUser = {
  id: string;
  phone: string | null;
  name: string | null;
  role: string;
  status?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "UNKNOWN_ERROR",
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (typeof window !== "undefined" && !headers.has("X-Client-Source")) {
    const { currentClientSource } = await import("./product-analytics");
    headers.set("X-Client-Source", currentClientSource());
  }
  const res = await fetch(path, {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const structured = data?.error && typeof data.error === "object" ? data.error : null;
    throw new ApiError(
      structured?.message ??
        (typeof data?.error === "string" ? data.error : `Ошибка запроса (${res.status})`),
      res.status,
      structured?.code ?? "UNKNOWN_ERROR",
      structured?.details
    );
  }
  return data as T;
}

export function formatPrice(kzt: number): string {
  return `${kzt.toLocaleString("ru-RU")} ₸`;
}

export function formatPickupWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
  const start = new Date(startIso);
  const today = new Date();
  const dayLabel =
    start.toDateString() === today.toDateString()
      ? "сегодня"
      : start.toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "Asia/Almaty" });
  return `${dayLabel} ${fmt(startIso)}–${fmt(endIso)}`;
}

export function discountPct(bag: Pick<Bag, "price" | "originalPrice">): number {
  if (bag.originalPrice <= 0) return 0;
  return Math.round((1 - bag.price / bag.originalPrice) * 100);
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function venueImage(category: string): string {
  if (category === "CAFE") return "/images/food-coffee.jpg";
  if (category === "BAKERY") return "/images/food-bread.jpg";
  return "/images/food-bowl.jpg";
}
