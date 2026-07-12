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
      include: { venue: true },
    });
    if (!bag) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    return json({ bag });
  });
}
