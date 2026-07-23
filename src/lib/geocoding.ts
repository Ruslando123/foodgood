import { isInKazakhstan } from "@/lib/kazakhstan";

type PhotonFeature = {
  geometry?: { type?: string; coordinates?: unknown[] };
  properties?: {
    name?: unknown;
    street?: unknown;
    housenumber?: unknown;
    city?: unknown;
    district?: unknown;
    state?: unknown;
    country?: unknown;
  };
};

export type AddressSuggestion = {
  id: string;
  address: string;
  primary: string;
  secondary: string;
  lat: number;
  lng: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

export function photonSuggestions(payload: unknown): AddressSuggestion[] {
  const features = payload && typeof payload === "object" && "features" in payload
    ? (payload as { features?: unknown }).features
    : null;
  if (!Array.isArray(features)) return [];

  return features.flatMap((featureValue, index) => {
    const feature = featureValue as PhotonFeature;
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInKazakhstan(lat, lng)) return [];

    const properties = feature.properties ?? {};
    const name = text(properties.name);
    const street = text(properties.street);
    const house = text(properties.housenumber);
    const primary = street
      ? `${street}${house ? `, ${house}` : ""}`
      : name;
    if (!primary) return [];

    const secondaryParts = unique([
      text(properties.city),
      text(properties.district),
      text(properties.state),
      text(properties.country),
    ]).filter((part) => part !== primary && part !== street);
    const secondary = secondaryParts.join(", ");
    const address = [primary, secondary].filter(Boolean).join(", ");
    return [{
      id: `${lng}:${lat}:${index}`,
      address,
      primary,
      secondary,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    }];
  });
}
