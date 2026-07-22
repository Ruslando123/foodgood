import { haversineKm } from "@/lib/geo";
import { kazakhstanCityById } from "@/lib/kazakhstan";
import { ApiError } from "@/shared/server/api";
import type { Prisma } from "@prisma/client";

const DEFAULT_CATEGORIES = ["CAFE", "BAKERY"];

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export type PilotConfig = ReturnType<typeof getPilotConfig>;

/** Closed PAY_AT_VENUE pilot configuration. All values are enforced server-side. */
export function getPilotConfig() {
  const cityId = process.env.FOODGOOD_PILOT_CITY_ID?.trim() || "almaty";
  const city = kazakhstanCityById(cityId) ?? kazakhstanCityById("almaty")!;
  const parsedCategories = (process.env.FOODGOOD_PILOT_CATEGORIES || DEFAULT_CATEGORIES.join(","))
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const allowedCategories = parsedCategories.length ? parsedCategories : DEFAULT_CATEGORIES;
  return {
    mode: "PAY_AT_VENUE" as const,
    cityId: city.id,
    cityName: city.name,
    district: {
      name: process.env.FOODGOOD_PILOT_DISTRICT_NAME?.trim() || "пилотная зона Алматы",
      centerLat: numberEnv("FOODGOOD_PILOT_CENTER_LAT", city.lat, -90, 90),
      centerLng: numberEnv("FOODGOOD_PILOT_CENTER_LNG", city.lng, -180, 180),
      radiusKm: numberEnv("FOODGOOD_PILOT_RADIUS_KM", 25, 0.1, 100),
    },
    limits: {
      venues: Math.trunc(numberEnv("FOODGOOD_PILOT_MAX_VENUES", 5, 1, 100)),
      activeBagsPerVenue: Math.trunc(numberEnv("FOODGOOD_PILOT_MAX_ACTIVE_BAGS_PER_VENUE", 10, 1, 100)),
      quantityPerBag: Math.trunc(numberEnv("FOODGOOD_PILOT_MAX_BAG_QUANTITY", 10, 1, 1000)),
      quantityPerOrder: Math.trunc(numberEnv("FOODGOOD_PILOT_MAX_ORDER_QUANTITY", 3, 1, 10)),
      activeOrdersPerCustomer: Math.trunc(numberEnv("FOODGOOD_PILOT_MAX_ACTIVE_ORDERS_PER_CUSTOMER", 5, 1, 100)),
      pickupWindowHours: numberEnv("FOODGOOD_PILOT_MAX_PICKUP_WINDOW_HOURS", 4, 0.25, 24),
    },
    features: {
      publicReviews: process.env.FOODGOOD_PILOT_PUBLIC_REVIEWS === "true",
      delivery: false,
      prepaid: false,
      loyalty: false,
      ai: false,
    },
    allowedCategories,
  };
}

export function publicPilotConfig() {
  const config = getPilotConfig();
  return {
    mode: config.mode,
    cityId: config.cityId,
    cityName: config.cityName,
    district: { name: config.district.name, radiusKm: config.district.radiusKm },
    limits: config.limits,
    features: config.features,
    allowedCategories: config.allowedCategories,
  };
}

export function isVenueInPilotScope(venue: { cityId: string; category: string; lat: number; lng: number }): boolean {
  const config = getPilotConfig();
  return venue.cityId === config.cityId
    && config.allowedCategories.includes(venue.category)
    && haversineKm(venue.lat, venue.lng, config.district.centerLat, config.district.centerLng) <= config.district.radiusKm;
}

export function assertVenueInPilotScope(venue: { cityId: string; category: string; lat: number; lng: number }): void {
  const config = getPilotConfig();
  if (venue.cityId !== config.cityId) {
    throw new ApiError(409, "OUTSIDE_PILOT_CITY", `Пилот работает только в городе ${config.cityName}`);
  }
  if (!config.allowedCategories.includes(venue.category)) {
    throw new ApiError(409, "CATEGORY_DISABLED_FOR_PILOT", "Эта категория пока не участвует в пилоте");
  }
  if (!isVenueInPilotScope(venue)) {
    throw new ApiError(409, "OUTSIDE_PILOT_DISTRICT", `Адрес находится за пределами зоны «${config.district.name}»`);
  }
}

/** Serializes venue activation/creation so the global closed-pilot cap cannot be raced. */
export async function enforcePilotVenueCapacity(tx: Prisma.TransactionClient, excludeVenueId?: string): Promise<void> {
  const config = getPilotConfig();
  // pg_advisory_xact_lock returns PostgreSQL's unsupported `void` type. Keep
  // the lock call materialized, but expose only an integer to Prisma so pooled
  // production drivers do not attempt to deserialize `void`.
  await tx.$queryRaw<Array<{ lockAcquired: number }>>`
    WITH lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtext('foodgood:pilot:venues'))
    )
    SELECT 1::int AS "lockAcquired" FROM lock
  `;
  const active = await tx.venue.findMany({
    where: { status: "ACTIVE", ...(excludeVenueId ? { id: { not: excludeVenueId } } : {}) },
    select: { cityId: true, category: true, lat: true, lng: true },
  });
  if (active.filter(isVenueInPilotScope).length >= config.limits.venues) {
    throw new ApiError(409, "PILOT_VENUE_LIMIT", `В пилоте доступно не более ${config.limits.venues} заведений`);
  }
}
