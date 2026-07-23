import type { Bag } from "@/lib/client/api";
import { isInKazakhstan, kazakhstanCityById } from "@/lib/kazakhstan";

export const CATALOG_CACHE_TTL_MS = 60_000;
export const AUTOMATIC_LOCATION_TTL_MS = 5 * 60_000;

export type LocationPreference = {
  lat: number;
  lng: number;
  cityId: string;
  source: "automatic" | "manual";
  savedAt: number;
};

export type CatalogCacheParams = {
  location: LocationPreference | null;
  search: string;
  category: string;
  maxPrice: string;
  minDiscount: string;
  minRating: string;
  maxDistance: string;
  todayOnly: boolean;
  sort: "soon" | "distance" | "price" | "discount";
  view: "list" | "map";
};

export type CatalogCacheEntry = {
  version: 1;
  savedAt: number;
  params: CatalogCacheParams;
  bags: Bag[];
  nextCursor: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLocationPreference(value: unknown): value is LocationPreference {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.lat)
    && isFiniteNumber(value.lng)
    && isInKazakhstan(value.lat, value.lng)
    && typeof value.cityId === "string"
    && kazakhstanCityById(value.cityId) !== null
    && (value.source === "automatic" || value.source === "manual")
    && isFiniteNumber(value.savedAt)
    && value.savedAt >= 0
  );
}

function isBag(value: unknown): value is Bag {
  if (!isRecord(value) || !isRecord(value.venue)) return false;
  return (
    typeof value.id === "string"
    && typeof value.venueId === "string"
    && typeof value.title === "string"
    && typeof value.description === "string"
    && typeof value.composition === "string"
    && typeof value.allergens === "string"
    && typeof value.storage === "string"
    && typeof value.examplePhoto === "string"
    && isFiniteNumber(value.price)
    && isFiniteNumber(value.originalPrice)
    && isFiniteNumber(value.quantityTotal)
    && isFiniteNumber(value.quantityLeft)
    && typeof value.pickupStart === "string"
    && typeof value.pickupEnd === "string"
    && typeof value.status === "string"
    && typeof value.venue.id === "string"
    && typeof value.venue.name === "string"
    && typeof value.venue.description === "string"
    && typeof value.venue.address === "string"
    && isFiniteNumber(value.venue.lat)
    && isFiniteNumber(value.venue.lng)
    && typeof value.venue.cityId === "string"
    && typeof value.venue.twoGisUrl === "string"
    && typeof value.venue.category === "string"
    && typeof value.venue.photo === "string"
    && typeof value.venue.contactPhone === "string"
    && typeof value.venue.openingHours === "string"
    && typeof value.venue.sellerLegalName === "string"
    && typeof value.venue.sellerLegalType === "string"
  );
}

function isParams(value: unknown): value is CatalogCacheParams {
  if (!isRecord(value)) return false;
  const stringKeys = ["search", "category", "maxPrice", "minDiscount", "minRating", "maxDistance"] as const;
  return (
    (value.location === null || isLocationPreference(value.location))
    && stringKeys.every((key) => typeof value[key] === "string")
    && typeof value.todayOnly === "boolean"
    && ["soon", "distance", "price", "discount"].includes(String(value.sort))
    && (value.view === "list" || value.view === "map")
  );
}

export function parseLocationPreference(raw: string | null): LocationPreference | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isLocationPreference(parsed)) return parsed;

    // Migrate the previous storage shape. City-centre coordinates came from
    // explicit selection; other coordinates came from browser geolocation.
    if (
      isRecord(parsed)
      && isFiniteNumber(parsed.lat)
      && isFiniteNumber(parsed.lng)
      && isInKazakhstan(parsed.lat, parsed.lng)
      && typeof parsed.cityId === "string"
    ) {
      const city = kazakhstanCityById(parsed.cityId);
      if (!city) return null;
      const manual = parsed.lat === city.lat && parsed.lng === city.lng;
      return {
        lat: parsed.lat,
        lng: parsed.lng,
        cityId: parsed.cityId,
        source: manual ? "manual" : "automatic",
        savedAt: 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function isLocationPreferenceFresh(
  location: LocationPreference,
  now = Date.now(),
  automaticTtlMs = AUTOMATIC_LOCATION_TTL_MS
): boolean {
  if (location.source === "manual") return true;
  const age = now - location.savedAt;
  return age >= 0 && age <= automaticTtlMs;
}

export function parseCatalogCache(
  raw: string | null,
  now = Date.now(),
  ttlMs = CATALOG_CACHE_TTL_MS
): CatalogCacheEntry | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.version !== 1
      || !isFiniteNumber(parsed.savedAt)
      || parsed.savedAt < 0
      || now - parsed.savedAt < 0
      || now - parsed.savedAt > ttlMs
      || !isParams(parsed.params)
      || !Array.isArray(parsed.bags)
      || !parsed.bags.every(isBag)
      || !(parsed.nextCursor === null || typeof parsed.nextCursor === "string")
    ) {
      return null;
    }
    return parsed as CatalogCacheEntry;
  } catch {
    return null;
  }
}

export function locationsMatch(
  first: LocationPreference | null,
  second: LocationPreference | null
): boolean {
  if (!first || !second) return first === second;
  return first.cityId === second.cityId && first.lat === second.lat && first.lng === second.lng;
}
