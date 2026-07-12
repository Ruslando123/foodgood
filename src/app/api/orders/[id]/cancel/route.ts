import { NextRequest } from "next/server";
import { requireUser } from "@/modules/auth/server";
import { prisma } from "@/lib/db";
import { cancelOrder, reconcilePendingPayments, throwOrderApiError } from "@/modules/orders";
import { apiRoute, assertSameOrigin, json } from "@/shared/server/api";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    try {
      let order = await cancelOrder(user.id, id);
      if (process.env.NODE_ENV !== "production") {
        await reconcilePendingPayments(10);
        order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { bag: { include: { venue: true } }, payment: true } });
      }
      return json({ order });
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
