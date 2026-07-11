import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { VENUE_CATEGORIES } from "@/lib/config";
import { requireMerchant, requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { finiteNumber, optionalString, requiredString } from "@/shared/validation";

export async function GET() {
  return apiRoute(async () => {
    const user = await requireUser();
    const venues = await prisma.venue.findMany({ where: user.role === "ADMIN" ? {} : { ownerId: user.id } });
    return json({ venues });
  });
}

/** Владелец создаёт заведение сам после того, как админ выдал ему доступ. */
export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    const owner = await requireMerchant();
    const body = await readJsonObject(req);
    const name = requiredString(body.name, "name", { max: 120 });
    const address = requiredString(body.address, "address", { max: 300 });
    const lat = finiteNumber(body.lat, "lat", { min: -90, max: 90 });
    const lng = finiteNumber(body.lng, "lng", { min: -180, max: 180 });
    const cat = requiredString(body.category ?? "CAFE", "category", { max: 40 });
    const description = optionalString(body.description, "description", 1000);
    const photo = optionalString(body.photo, "photo", 200) || "🍽️";
    if (!(cat in VENUE_CATEGORIES)) {
      throw new ApiError(400, "UNKNOWN_VENUE_CATEGORY", "Неизвестная категория");
    }
    const venue = await prisma.venue.create({
      data: { name, address, lat, lng, category: cat, description, photo, ownerId: owner.id },
    });
    return json({ venue }, { status: 201 });
  });
}
