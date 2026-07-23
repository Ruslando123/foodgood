import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiRoute, ApiError, json } from "@/shared/server/api";
import { publicVenueSelect, toPublicVenueDto } from "@/modules/api/dto";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(_req, async () => {
    const { id } = await params;
    const bag = await prisma.bag.findFirst({
      where: {
        id,
        status: { in: ["ACTIVE", "SOLD_OUT"] },
        pickupEnd: { gt: new Date() },
        suitableForSaleAttested: true,
        storageCompliantAttested: true,
        allergensCurrentAttested: true,
        categoryAllowedAttested: true,
        venue: {
          status: "ACTIVE",
        },
      },
      select: {
        id: true, venueId: true, title: true, description: true, composition: true, allergens: true, storage: true, examplePhoto: true, price: true,
        originalPrice: true, quantityTotal: true, quantityLeft: true,
        pickupStart: true, pickupEnd: true, status: true,
        venue: {
          select: {
            ...publicVenueSelect,
            reviews: {
              where: { moderationStatus: "PUBLISHED" },
              select: { id: true, rating: true, comment: true, createdAt: true, user: { select: { name: true } } },
              orderBy: { createdAt: "desc" },
              take: 3,
            },
          },
        },
      },
    });
    if (!bag) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    return json({
      bag: {
        id: bag.id,
        venueId: bag.venueId,
        title: bag.title,
        description: bag.description,
        composition: bag.composition,
        allergens: bag.allergens,
        storage: bag.storage,
        examplePhoto: bag.examplePhoto,
        price: bag.price,
        originalPrice: bag.originalPrice,
        quantityTotal: bag.quantityTotal,
        quantityLeft: bag.quantityLeft,
        pickupStart: bag.pickupStart.toISOString(),
        pickupEnd: bag.pickupEnd.toISOString(),
        status: bag.status,
        venue: {
          ...toPublicVenueDto(bag.venue, { reviewCount: bag.venue.ratingCount }),
          reviews: ("reviews" in bag.venue ? bag.venue.reviews : []).map((review) => ({
            ...review,
            createdAt: review.createdAt.toISOString(),
          })),
        },
      },
    }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=15" } });
  });
}
