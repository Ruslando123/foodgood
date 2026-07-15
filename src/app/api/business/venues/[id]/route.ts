import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { VENUE_CATEGORIES } from "@/lib/config";
import { nearestKazakhstanCity } from "@/lib/kazakhstan";
import { removeVenuePhoto, saveVenuePhoto } from "@/lib/venue-photos";
import { normalizeTwoGisUrl } from "@/lib/maps";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, ApiError, assertSameOrigin, json, readJsonObject } from "@/shared/server/api";
import { finiteNumber, optionalString, requiredString } from "@/shared/validation";

async function ownedVenue(ownerId: string, id: string) {
  const venue = await prisma.venue.findUnique({ where: { id } });
  if (!venue || venue.ownerId !== ownerId) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
  return venue;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(_req, async () => {
    const owner = await requireMerchant(); const { id } = await params;
    return json({ venue: await ownedVenue(owner.id, id) });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const owner = await requireMerchant(); const { id } = await params;
    await ownedVenue(owner.id, id);
    const body = await readJsonObject(req);
    const category = requiredString(body.category, "category", { max: 40 });
    if (!(category in VENUE_CATEGORIES)) throw new ApiError(400, "UNKNOWN_VENUE_CATEGORY", "Неизвестная категория");
    const lat = finiteNumber(body.lat, "lat", { min: -90, max: 90 });
    const lng = finiteNumber(body.lng, "lng", { min: -180, max: 180 });
    let twoGisUrl: string;
    try { twoGisUrl = normalizeTwoGisUrl(optionalString(body.twoGisUrl, "twoGisUrl", 1000)); }
    catch { throw new ApiError(400, "INVALID_TWO_GIS_URL", "Укажите ссылку на карточку заведения с сайта 2GIS"); }
    const venue = await prisma.venue.update({ where: { id }, data: {
      name: requiredString(body.name, "name", { max: 120 }),
      address: requiredString(body.address, "address", { max: 300 }),
      description: optionalString(body.description, "description", 1000),
      contactPhone: optionalString(body.contactPhone, "contactPhone", 40),
      openingHours: optionalString(body.openingHours, "openingHours", 500),
      twoGisUrl,
      category,
      lat,
      lng,
      cityId: nearestKazakhstanCity(lat, lng).id,
    } });
    return json({ venue });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    assertSameOrigin(req);
    const owner = await requireMerchant();
    const { id } = await params;
    const venue = await ownedVenue(owner.id, id);
    const form = await req.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) throw new ApiError(400, "PHOTO_REQUIRED", "Выберите фотографию");
    let photo: string;
    try { photo = await saveVenuePhoto(file); }
    catch (error) {
      if (error instanceof Error && error.message === "PHOTO_SIZE") throw new ApiError(400, "PHOTO_TOO_LARGE", "Фото должно быть не больше 5 МБ");
      if (error instanceof Error && error.message === "PHOTO_DIMENSIONS") throw new ApiError(400, "PHOTO_DIMENSIONS", "Фото должно быть от 240×160 пикселей и не больше 36 мегапикселей");
      throw new ApiError(400, "PHOTO_FORMAT", "Поддерживаются только JPG, PNG и WebP");
    }
    try {
      const updated = await prisma.venue.update({ where: { id }, data: { photo } });
      await removeVenuePhoto(venue.photo);
      return json({ venue: updated });
    } catch (error) {
      await removeVenuePhoto(photo);
      throw error;
    }
  });
}
