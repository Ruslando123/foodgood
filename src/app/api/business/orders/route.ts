import { prisma } from "@/lib/db";
import { requireBusinessAccess } from "@/modules/auth/business";
import { apiRoute, json } from "@/shared/server/api";
import { merchantOrderSelect, toMerchantOrderDto } from "@/modules/api/dto";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const { owner } = await requireBusinessAccess();
    const orders = await prisma.order.findMany({
      where: { bag: { venue: { ownerId: owner.id } } },
      select: merchantOrderSelect,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return json({ orders: orders.map(toMerchantOrderDto) });
  });
}
