import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiRoute, ApiError, json } from "@/shared/server/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(_req, async () => {
    const { id } = await params;
    const venue = await prisma.venue.findUnique({
      where: { id },
      include: {
        bags: {
          where: { status: "ACTIVE", quantityLeft: { gt: 0 }, pickupEnd: { gt: new Date() } },
          orderBy: { pickupEnd: "asc" },
        },
        reviews: { where: { moderationStatus: "PUBLISHED" }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    return json({ venue });
  });
}
