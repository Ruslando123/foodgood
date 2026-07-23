import { describe, expect, it } from "vitest";
import type { Bag } from "@/lib/client/api";
import {
  isLocationPreferenceFresh,
  locationsMatch,
  parseCatalogCache,
  parseLocationPreference,
} from "@/lib/client/catalog-cache";

const now = 1_800_000_000_000;
const automaticLocation = {
  lat: 43.2389,
  lng: 76.8897,
  cityId: "almaty",
  source: "automatic" as const,
  savedAt: now - 30_000,
};

const bag: Bag = {
  id: "bag-1",
  venueId: "venue-1",
  title: "Вечерний пакет",
  description: "Выпечка",
  composition: "",
  allergens: "",
  storage: "",
  examplePhoto: "",
  price: 1500,
  originalPrice: 3000,
  quantityTotal: 4,
  quantityLeft: 2,
  pickupStart: "2026-07-23T12:00:00.000Z",
  pickupEnd: "2026-07-23T13:00:00.000Z",
  status: "ACTIVE",
  venue: {
    id: "venue-1",
    name: "Пекарня",
    description: "",
    address: "Алматы",
    lat: 43.2389,
    lng: 76.8897,
    cityId: "almaty",
    twoGisUrl: "",
    category: "BAKERY",
    photo: "",
    contactPhone: "",
    openingHours: "",
    sellerLegalName: "",
    sellerLegalType: "",
  },
};

function cacheJson(savedAt: number) {
  return JSON.stringify({
    version: 1,
    savedAt,
    params: {
      location: automaticLocation,
      search: "",
      category: "",
      maxPrice: "",
      minDiscount: "",
      minRating: "",
      maxDistance: "",
      todayOnly: false,
      sort: "distance",
      view: "list",
    },
    bags: [bag],
    nextCursor: null,
  });
}

describe("catalog session cache", () => {
  it("restores a valid cache within the short TTL", () => {
    expect(parseCatalogCache(cacheJson(now - 59_000), now)?.bags).toEqual([bag]);
  });

  it("rejects stale, future and malformed cache values", () => {
    expect(parseCatalogCache(cacheJson(now - 60_001), now)).toBeNull();
    expect(parseCatalogCache(cacheJson(now + 1), now)).toBeNull();
    expect(parseCatalogCache("{bad json", now)).toBeNull();
    expect(parseCatalogCache(JSON.stringify({ version: 1, savedAt: now, params: {}, bags: [] }), now)).toBeNull();
  });
});

describe("saved catalogue location", () => {
  it("reuses a fresh automatic location but refreshes a stale one", () => {
    expect(isLocationPreferenceFresh(automaticLocation, now)).toBe(true);
    expect(isLocationPreferenceFresh({ ...automaticLocation, savedAt: now - 300_001 }, now)).toBe(false);
  });

  it("keeps a manual city until the user changes or clears it", () => {
    const manual = { ...automaticLocation, source: "manual" as const, savedAt: 1 };
    expect(isLocationPreferenceFresh(manual, now)).toBe(true);
    expect(parseLocationPreference(JSON.stringify(manual))).toEqual(manual);
    expect(parseLocationPreference(JSON.stringify({
      lat: 43.2389,
      lng: 76.8897,
      cityId: "almaty",
    }))).toMatchObject({ source: "manual", cityId: "almaty" });
  });

  it("rejects invalid coordinates and compares locations independently of timestamps", () => {
    expect(parseLocationPreference(JSON.stringify({ ...automaticLocation, lat: 55.75, lng: 37.62 }))).toBeNull();
    expect(locationsMatch(automaticLocation, { ...automaticLocation, savedAt: now })).toBe(true);
    expect(locationsMatch(automaticLocation, { ...automaticLocation, cityId: "astana" })).toBe(false);
  });
});
