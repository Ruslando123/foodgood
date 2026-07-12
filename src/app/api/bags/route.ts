import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { kazakhstanCityById } from "@/lib/kazakhstan";
import { filterAndSortCatalog, parseCatalogQuery } from "@/modules/catalog/query";
import { apiRoute, ApiError, json } from "@/shared/server/api";

/** Активные пакеты; при переданных lat/lng — с расстоянием и сортировкой по близости. */
export async function GET(req: NextRequest) {
  return apiRoute(async () => {
    const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
    const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
    const hasLocation =
      Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    const cityParam = req.nextUrl.searchParams.get("city");
    const selectedCity = cityParam ? kazakhstanCityById(cityParam) : null;
    if (cityParam && !selectedCity) throw new ApiError(400, "UNKNOWN_CITY", "Неизвестный город Казахстана");
    const query = parseCatalogQuery(req.nextUrl.searchParams);

    const bags = await prisma.bag.findMany({
      where: {
        status: "ACTIVE",
        quantityLeft: { gt: 0 },
        pickupEnd: { gt: new Date() },
        venue: { status: "ACTIVE", ...(selectedCity ? { cityId: selectedCity.id } : {}) },
      },
      include: { venue: { include: { reviews: { where: { moderationStatus: "PUBLISHED" }, select: { rating: true } } } } },
      orderBy: { pickupEnd: "asc" },
      take: 100,
    });

    const items = bags.map((bag) => ({
      ...bag,
      venue: { ...bag.venue, rating: bag.venue.reviews.length ? bag.venue.reviews.reduce((sum, review) => sum + review.rating, 0) / bag.venue.reviews.length : null, reviews: undefined },
      distanceKm: hasLocation
        ? haversineKm(lat, lng, bag.venue.lat, bag.venue.lng)
        : null,
    }));
    const filtered = filterAndSortCatalog(items, query);
    return json({ bags: filtered, nextCursor: null });
  });
}
