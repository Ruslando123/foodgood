import { NextRequest } from "next/server";
import { photonSuggestions } from "@/lib/geocoding";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, ApiError, json } from "@/shared/server/api";
import { consumeRateLimit } from "@/shared/server/rate-limit";

const PHOTON_ENDPOINT = "https://photon.komoot.io/api";

export async function GET(req: NextRequest) {
  return apiRoute(req, async () => {
    const user = await requireMerchant();
    await consumeRateLimit(`geocoding:search:${user.id}`, { limit: 60, windowMs: 60_000 });

    const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (query.length < 3 || query.length > 120) {
      throw new ApiError(400, "INVALID_ADDRESS_QUERY", "Введите минимум 3 символа адреса");
    }

    const url = new URL(PHOTON_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "7");
    url.searchParams.set("countrycode", "KZ");
    url.searchParams.set("bbox", "46,40.5,88.5,55.5");
    for (const layer of ["house", "street", "locality", "district", "city"]) {
      url.searchParams.append("layer", layer);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "FoodGood/1.0 (support@foodgood.kz)",
        },
        signal: AbortSignal.timeout(6_000),
      });
    } catch {
      throw new ApiError(503, "GEOCODING_UNAVAILABLE", "Поиск адресов временно недоступен");
    }
    if (!response.ok) {
      throw new ApiError(503, "GEOCODING_UNAVAILABLE", "Поиск адресов временно недоступен");
    }

    const suggestions = photonSuggestions(await response.json());
    return json({ suggestions }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  });
}
