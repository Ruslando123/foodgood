import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { expireStale } from "@/modules/orders";
import { apiRoute, json } from "@/shared/server/api";

/** Сводка мерчанта: выручка, комиссия платформы, спасённые пакеты. */
export async function GET() {
  return apiRoute(async () => {
    const user = await requireMerchant();
    await expireStale();
    const completed = await prisma.order.findMany({
      where: { bag: { venue: { ownerId: user.id } }, status: "COMPLETED" },
      select: { totalPrice: true, platformFee: true, quantity: true },
    });
    const activePaid = await prisma.order.count({
      where: { bag: { venue: { ownerId: user.id } }, status: "PAID" },
    });

    const gross = completed.reduce((s, o) => s + o.totalPrice, 0);
    const fees = completed.reduce((s, o) => s + o.platformFee, 0);
    const bagsSaved = completed.reduce((s, o) => s + o.quantity, 0);

    return json({
      stats: {
        gross,
        fees,
        net: gross - fees,
        bagsSaved,
        awaitingPickup: activePaid,
      },
    });
  });
}
