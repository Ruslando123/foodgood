import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, json } from "@/shared/server/api";
import { merchantOrderSelect, toMerchantOrderDto } from "@/modules/api/dto";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireMerchant();
    const orders = await prisma.order.findMany({
      where: { bag: { venue: { ownerId: user.id } } },
      select: merchantOrderSelect,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return json({ orders: orders.map(toMerchantOrderDto) });
  });
}
