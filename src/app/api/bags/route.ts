import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { expireStale } from "@/modules/orders";
import { filterAndSortCatalog, parseCatalogQuery } from "@/modules/catalog/query";
import { apiRoute, json } from "@/shared/server/api";

/** Активные пакеты; при переданных lat/lng — с расстоянием и сортировкой по близости. */
export async function GET(req: NextRequest) {
  return apiRoute(async () => {
    await expireStale();

    const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
    const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
    const hasLocation =
      Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    const query = parseCatalogQuery(req.nextUrl.searchParams);

    const bags = await prisma.bag.findMany({
      where: { status: "ACTIVE", quantityLeft: { gt: 0 }, pickupEnd: { gt: new Date() } },
      include: { venue: true },
      orderBy: { pickupEnd: "asc" },
    });

    const items = bags.map((bag) => ({
      ...bag,
      distanceKm: hasLocation
        ? haversineKm(lat, lng, bag.venue.lat, bag.venue.lng)
        : null,
    }));
    const filtered = filterAndSortCatalog(items, query);

    return json({ bags: filtered });
  });
}
