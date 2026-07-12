import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { optionalString } from "@/shared/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const owner = await requireMerchant();
    const { id } = await params;
    const body = await readJsonObject(req);
    const venue = await prisma.venue.findUnique({ where: { id } });
    if (!venue || venue.ownerId !== owner.id) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    const photo = optionalString(body.photo, "photo", 200);
    if (!photo || !/^https?:\/\//i.test(photo)) throw new ApiError(400, "INVALID_PHOTO_URL", "Укажите полную ссылку на фото, начиная с http:// или https://");
    const updated = await prisma.venue.update({ where: { id }, data: { photo } });
    return json({ venue: updated });
  });
}
