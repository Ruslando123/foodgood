import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiRoute, ApiError, json } from "@/shared/server/api";
import { publicVenueSelect, toPublicVenueDto } from "@/modules/api/dto";
import { PILOT_CATEGORY_ALLOWLIST } from "@/lib/config";
import { getPilotConfig, isVenueInPilotScope, publicPilotConfig } from "@/lib/pilot";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(_req, async () => {
    const { id } = await params;
    const venue = await prisma.venue.findFirst({
      where: {
        id,
        status: "ACTIVE",
        category: { in: [...PILOT_CATEGORY_ALLOWLIST] },
      },
      select: {
        ...publicVenueSelect,
        bags: {
          where: { status: "ACTIVE", quantityLeft: { gt: 0 }, pickupEnd: { gt: new Date() }, suitableForSaleAttested: true, storageCompliantAttested: true, allergensCurrentAttested: true, categoryAllowedAttested: true },
          orderBy: { pickupEnd: "asc" },
          take: 100,
          select: {
            id: true, venueId: true, title: true, description: true, composition: true, allergens: true, storage: true, examplePhoto: true, price: true,
            originalPrice: true, quantityTotal: true, quantityLeft: true,
            pickupStart: true, pickupEnd: true, status: true,
          },
        },
        ...(getPilotConfig().features.publicReviews ? { reviews: {
          where: { moderationStatus: "PUBLISHED" },
          select: { id: true, rating: true, comment: true, createdAt: true, user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        } } : {}),
      },
    });
    if (!venue || !isVenueInPilotScope(venue)) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    return json({
      venue: {
        ...toPublicVenueDto(venue),
        bags: venue.bags.map((bag) => ({
          ...bag,
          pickupStart: bag.pickupStart.toISOString(),
          pickupEnd: bag.pickupEnd.toISOString(),
        })),
        reviews: ("reviews" in venue ? venue.reviews : []).map((review) => ({
          ...review,
          createdAt: review.createdAt.toISOString(),
        })),
      },
      pilot: publicPilotConfig(),
    });
  });
}
