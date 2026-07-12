import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { removeVenuePhoto, saveVenuePhoto } from "@/lib/venue-photos";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, ApiError, json } from "@/shared/server/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const owner = await requireMerchant();
    const { id } = await params;
    const venue = await prisma.venue.findUnique({ where: { id } });
    if (!venue || venue.ownerId !== owner.id) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    const form = await req.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) throw new ApiError(400, "PHOTO_REQUIRED", "Выберите фотографию");
    let photo: string;
    try { photo = await saveVenuePhoto(file); }
    catch (error) {
      if (error instanceof Error && error.message === "PHOTO_SIZE") throw new ApiError(400, "PHOTO_TOO_LARGE", "Фото должно быть не больше 5 МБ");
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
