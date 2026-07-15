import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { VENUE_CATEGORIES } from "@/lib/config";
import { nearestKazakhstanCity } from "@/lib/kazakhstan";
import { removeVenuePhoto, saveVenuePhoto } from "@/lib/venue-photos";
import { normalizeTwoGisUrl } from "@/lib/maps";
import { requireMerchant, requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, assertSameOrigin, json } from "@/shared/server/api";
import { finiteNumber, optionalString, requiredString } from "@/shared/validation";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireUser();
    const venues = await prisma.venue.findMany({ where: user.role === "ADMIN" ? {} : { ownerId: user.id } });
    return json({ venues });
  });
}

/** Владелец создаёт заведение сам после того, как админ выдал ему доступ. */
export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    assertSameOrigin(req);
    const owner = await requireMerchant();
    const form = await req.formData();
    const body = Object.fromEntries(form.entries());
    const file = form.get("photo");
    if (!(file instanceof File)) throw new ApiError(400, "PHOTO_REQUIRED", "Добавьте фотографию заведения");
    const name = requiredString(body.name, "name", { max: 120 });
    const address = requiredString(body.address, "address", { max: 300 });
    const lat = finiteNumber(body.lat, "lat", { min: -90, max: 90 });
    const lng = finiteNumber(body.lng, "lng", { min: -180, max: 180 });
    const cat = requiredString(body.category ?? "CAFE", "category", { max: 40 });
    const description = optionalString(body.description, "description", 1000);
    const contactPhone = optionalString(body.contactPhone, "contactPhone", 40);
    const openingHours = optionalString(body.openingHours, "openingHours", 500);
    let twoGisUrl: string;
    try { twoGisUrl = normalizeTwoGisUrl(optionalString(body.twoGisUrl, "twoGisUrl", 1000)); }
    catch { throw new ApiError(400, "INVALID_TWO_GIS_URL", "Укажите ссылку на карточку заведения с сайта 2GIS"); }
    if (!(cat in VENUE_CATEGORIES)) {
      throw new ApiError(400, "UNKNOWN_VENUE_CATEGORY", "Неизвестная категория");
    }
    let photo: string;
    try { photo = await saveVenuePhoto(file); }
    catch (error) {
      if (error instanceof Error && error.message === "PHOTO_SIZE") throw new ApiError(400, "PHOTO_TOO_LARGE", "Фото должно быть не больше 5 МБ");
      if (error instanceof Error && error.message === "PHOTO_DIMENSIONS") throw new ApiError(400, "PHOTO_DIMENSIONS", "Фото должно быть от 240×160 пикселей и не больше 36 мегапикселей");
      throw new ApiError(400, "PHOTO_FORMAT", "Поддерживаются только JPG, PNG и WebP");
    }
    try {
      const venue = await prisma.venue.create({
        data: { name, address, lat, lng, cityId: nearestKazakhstanCity(lat, lng).id, category: cat, description, contactPhone, openingHours, twoGisUrl, photo, ownerId: owner.id },
      });
      return json({ venue }, { status: 201 });
    } catch (error) {
      await removeVenuePhoto(photo);
      throw error;
    }
  });
}
