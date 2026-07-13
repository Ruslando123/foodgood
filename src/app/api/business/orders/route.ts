import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, json } from "@/shared/server/api";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireMerchant();
    const orders = await prisma.order.findMany({
      where: { bag: { venue: { ownerId: user.id } } },
      include: { bag: { include: { venue: true } }, payment: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return json({ orders });
  });
}
