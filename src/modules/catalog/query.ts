import { VENUE_CATEGORIES } from "@/lib/config";
import { ApiError } from "@/shared/server/api";

export type CatalogSort = "soon" | "distance" | "price" | "discount";

export type CatalogQuery = {
  q: string;
  category: string | null;
  maxPrice: number | null;
  minDiscount: number;
  minRating: number;
  maxDistance: number | null;
  availableNow: boolean;
  todayOnly: boolean;
  sort: CatalogSort;
};

function optionalNumber(
  params: URLSearchParams,
  key: string,
  options: { min: number; max: number }
): number | null {
  const raw = params.get(key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < options.min || value > options.max) {
    throw new ApiError(400, "INVALID_QUERY", `Некорректный параметр «${key}»`, { key });
  }
  return value;
}

export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const q = (params.get("q") ?? "").trim();
  if (q.length > 80) {
    throw new ApiError(400, "INVALID_QUERY", "Поисковый запрос слишком длинный", { key: "q" });
  }

  const category = params.get("category");
  if (category && !(category in VENUE_CATEGORIES)) {
    throw new ApiError(400, "INVALID_QUERY", "Неизвестная категория", { key: "category" });
  }

  const sortValue = params.get("sort") ?? "soon";
  if (!(["soon", "distance", "price", "discount"] as const).includes(sortValue as CatalogSort)) {
    throw new ApiError(400, "INVALID_QUERY", "Неизвестная сортировка", { key: "sort" });
  }

  return {
    q,
    category,
    maxPrice: optionalNumber(params, "maxPrice", { min: 1, max: 10_000_000 }),
    minDiscount: optionalNumber(params, "minDiscount", { min: 0, max: 95 }) ?? 0,
    minRating: optionalNumber(params, "minRating", { min: 1, max: 5 }) ?? 0,
    maxDistance: optionalNumber(params, "maxDistance", { min: 0.1, max: 100 }),
    availableNow: params.get("availableNow") === "1",
    todayOnly: params.get("today") === "1",
    sort: sortValue as CatalogSort,
  };
}

type CatalogBag = {
  title: string;
  price: number;
  originalPrice: number;
  pickupStart: Date;
  pickupEnd: Date;
  distanceKm: number | null;
  venue: { name: string; address: string; category: string; rating?: number | null };
};

export function filterAndSortCatalog<T extends CatalogBag>(
  bags: T[],
  query: CatalogQuery,
  now = new Date()
): T[] {
  const needle = query.q.toLocaleLowerCase("ru");
  const filtered = bags.filter((bag) => {
    const discount = bag.originalPrice > 0 ? (1 - bag.price / bag.originalPrice) * 100 : 0;
    const searchable = `${bag.title} ${bag.venue.name} ${bag.venue.address}`.toLocaleLowerCase("ru");
    return (
      (!needle || searchable.includes(needle)) &&
      (!query.category || bag.venue.category === query.category) &&
      (query.maxPrice === null || bag.price <= query.maxPrice) &&
      discount >= query.minDiscount &&
      (query.minRating === 0 || (bag.venue.rating ?? 0) >= query.minRating) &&
      (query.maxDistance === null ||
        (bag.distanceKm !== null && bag.distanceKm <= query.maxDistance)) &&
      (!query.todayOnly || bag.pickupStart.toDateString() === now.toDateString()) &&
      (!query.availableNow || (bag.pickupStart <= now && bag.pickupEnd > now))
    );
  });

  return filtered.sort((a, b) => {
    if (query.sort === "price") return a.price - b.price;
    if (query.sort === "discount") {
      const discountA = 1 - a.price / Math.max(1, a.originalPrice);
      const discountB = 1 - b.price / Math.max(1, b.originalPrice);
      return discountB - discountA;
    }
    if (query.sort === "distance" && a.distanceKm !== null && b.distanceKm !== null) {
      return a.distanceKm - b.distanceKm;
    }
    return a.pickupEnd.getTime() - b.pickupEnd.getTime();
  });
}
