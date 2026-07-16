import { describe, expect, it } from "vitest";
import { normalizeTwoGisUrl, twoGisDirectionsUrl } from "@/lib/maps";

describe("2GIS directions", () => {
  it("builds an Almaty route from the current location to venue coordinates", () => {
    expect(twoGisDirectionsUrl({ lat: 43.2189, lng: 76.8897, cityId: "almaty" }))
      .toBe("https://2gis.kz/almaty/directions/points/%7C76.8897%2C43.2189?m=76.8897%2C43.2189%2F16");
  });

  it("maps internal city ids to 2GIS slugs", () => {
    expect(twoGisDirectionsUrl({ lat: 49.9483, lng: 82.6275, cityId: "oskemen" }))
      .toContain("2gis.kz/ust-kamenogorsk/directions/");
  });

  it("uses the exact organization id from a full 2GIS card link", () => {
    expect(twoGisDirectionsUrl({
      lat: 43.2402,
      lng: 76.9285,
      cityId: "almaty",
      twoGisUrl: "https://2gis.kz/almaty/firm/9429940000800624",
    })).toBe("https://2gis.kz/almaty/directions/points/%7C76.9285%2C43.2402%3B9429940000800624?m=76.9285%2C43.2402%2F16");
  });

  it("keeps a valid short 2GIS link and rejects unrelated domains", () => {
    expect(normalizeTwoGisUrl("go.2gis.com/abc123")).toBe("https://go.2gis.com/abc123");
    expect(twoGisDirectionsUrl({ lat: 43, lng: 76, twoGisUrl: "https://go.2gis.com/abc123" }))
      .toBe("https://go.2gis.com/abc123");
    expect(() => normalizeTwoGisUrl("https://example.com/venue")).toThrow("INVALID_TWO_GIS_URL");
    expect(() => normalizeTwoGisUrl("https://user@2gis.kz/almaty/firm/123")).toThrow("INVALID_TWO_GIS_URL");
  });
});
