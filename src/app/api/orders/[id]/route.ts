import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, ApiError, json } from "@/shared/server/api";
import { customerOrderSelect, toCustomerOrderDto } from "@/modules/api/dto";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(_req, async () => {
    const user = await requireUser();
    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      select: { ...customerOrderSelect, userId: true },
    });
    if (!order || order.userId !== user.id) {
      throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
    }
    return json({ order: toCustomerOrderDto(order) });
  });
}
