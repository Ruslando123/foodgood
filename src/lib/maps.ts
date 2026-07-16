const TWO_GIS_CITY_SLUGS: Record<string, string> = {
  oskemen: "ust-kamenogorsk",
  oral: "uralsk",
  petropavl: "petropavlovsk",
  turkistan: "turkestan",
};

const TWO_GIS_HOSTS = new Set([
  "2gis.kz",
  "www.2gis.kz",
  "2gis.com",
  "www.2gis.com",
  "go.2gis.com",
  "2gis.ru",
  "www.2gis.ru",
  "go.2gis.ru",
]);

function parsedTwoGisUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && TWO_GIS_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

export function normalizeTwoGisUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = parsedTwoGisUrl(candidate);
  if (!url) throw new Error("INVALID_TWO_GIS_URL");
  return url.toString();
}

/** Opens 2GIS directions with the current location as the route origin. */
export function twoGisDirectionsUrl({
  lat,
  lng,
  cityId = "almaty",
  twoGisUrl = "",
}: {
  lat: number;
  lng: number;
  cityId?: string;
  twoGisUrl?: string;
}): string {
  const point = `${lng},${lat}`;
  const mapPosition = encodeURIComponent(`${point}/16`);

  const exactUrl = parsedTwoGisUrl(twoGisUrl);
  if (exactUrl) {
    if (exactUrl.pathname.includes("/directions/")) return exactUrl.toString();
    const objectMatch = exactUrl.pathname.match(/^\/([^/]+)\/(?:firm|geo)\/(\d+)/);
    if (objectMatch) {
      const [, exactCity, objectId] = objectMatch;
      const destination = encodeURIComponent(`|${point};${objectId}`);
      return `${exactUrl.origin}/${exactCity}/directions/points/${destination}?m=${mapPosition}`;
    }
    return exactUrl.toString();
  }

  const city = TWO_GIS_CITY_SLUGS[cityId] ?? cityId;
  const destination = encodeURIComponent(`|${point}`);
  return `https://2gis.kz/${city}/directions/points/${destination}?m=${mapPosition}`;
}
