import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiRoute, ApiError, json } from "@/shared/server/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(async () => {
    const { id } = await params;
    const venue = await prisma.venue.findUnique({
      where: { id },
      include: {
        bags: {
          where: { status: "ACTIVE", quantityLeft: { gt: 0 }, pickupEnd: { gt: new Date() } },
          orderBy: { pickupEnd: "asc" },
        },
      },
    });
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    return json({ venue });
  });
}
