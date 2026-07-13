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
    const bag = await prisma.bag.findUnique({
      where: { id },
      select: {
        id: true, venueId: true, title: true, description: true, price: true,
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
    const ratings = await prisma.review.aggregate({ where: { venueId: bag.venueId, moderationStatus: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } });
    return json({
      bag: {
        id: bag.id,
        venueId: bag.venueId,
        title: bag.title,
        description: bag.description,
        price: bag.price,
        originalPrice: bag.originalPrice,
        quantityTotal: bag.quantityTotal,
        quantityLeft: bag.quantityLeft,
        pickupStart: bag.pickupStart.toISOString(),
        pickupEnd: bag.pickupEnd.toISOString(),
        status: bag.status,
        venue: {
          ...toPublicVenueDto(bag.venue, { rating: ratings._avg.rating, reviewCount: ratings._count._all }),
          reviews: bag.venue.reviews.map((review) => ({
            ...review,
            createdAt: review.createdAt.toISOString(),
          })),
        },
      },
    });
  });
}
