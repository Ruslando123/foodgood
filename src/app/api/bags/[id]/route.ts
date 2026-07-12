import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiRoute, ApiError, json } from "@/shared/server/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(async () => {
    const { id } = await params;
    const bag = await prisma.bag.findUnique({
      where: { id },
      include: { venue: { include: { reviews: { where: { moderationStatus: "PUBLISHED" }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 3 } } } },
    });
    if (!bag) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    const ratings = await prisma.review.aggregate({ where: { venueId: bag.venueId, moderationStatus: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } });
    return json({ bag: { ...bag, venue: { ...bag.venue, rating: ratings._avg.rating, reviewCount: ratings._count._all } } });
  });
}
