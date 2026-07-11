import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json } from "@/shared/server/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: { bag: { include: { venue: true } }, payment: true },
    });
    if (!order || order.userId !== user.id) {
      throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
    }
    return json({ order });
  });
}
