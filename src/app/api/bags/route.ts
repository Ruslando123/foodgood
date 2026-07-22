import { NextRequest } from "next/server";
import { kazakhstanCityById, nearestKazakhstanCity } from "@/lib/kazakhstan";
import { zonedDayBounds } from "@/lib/timezone";
import { parseCatalogQuery } from "@/modules/catalog/query";
import { queryCatalog } from "@/modules/catalog/db";
import { apiRoute, ApiError, json } from "@/shared/server/api";
import { getPilotConfig, publicPilotConfig } from "@/lib/pilot";

/** Активные пакеты; при переданных lat/lng — с расстоянием и сортировкой по близости. */
export async function GET(req: NextRequest) {
  return apiRoute(req, async () => {
    const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
    const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
    const hasLocation =
      Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    const cityParam = req.nextUrl.searchParams.get("city");
    const selectedCity = cityParam ? kazakhstanCityById(cityParam) : null;
    if (cityParam && !selectedCity) throw new ApiError(400, "UNKNOWN_CITY", "Неизвестный город Казахстана");
    const pilot = getPilotConfig();
    if (selectedCity && selectedCity.id !== pilot.cityId) throw new ApiError(409, "OUTSIDE_PILOT_CITY", `Пилот работает только в городе ${pilot.cityName}`);
    const query = parseCatalogQuery(req.nextUrl.searchParams);
    if (query.category && !pilot.allowedCategories.includes(query.category)) throw new ApiError(409, "CATEGORY_DISABLED_FOR_PILOT", "Эта категория пока не участвует в пилоте");
    if (query.minRating > 0 && !pilot.features.publicReviews) throw new ApiError(409, "PUBLIC_REVIEWS_DISABLED", "Публичные отзывы отключены на время пилота");
    const catalogCity = selectedCity ?? (hasLocation ? nearestKazakhstanCity(lat, lng) : null);
    const todayBounds = query.todayOnly ? zonedDayBounds(new Date(), catalogCity?.timeZone ?? "Asia/Almaty") : null;

    const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 24);
    const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 24;
    const result = await queryCatalog({
      query,
      cityId: selectedCity?.id,
      ...(hasLocation ? { lat, lng } : {}),
      ...(todayBounds ? { todayStartUtc: todayBounds.startUtc, tomorrowStartUtc: todayBounds.endUtc } : {}),
      cursor: req.nextUrl.searchParams.get("cursor"),
      limit,
    });
    return json({ ...result, pilot: publicPilotConfig() }, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  });
}
