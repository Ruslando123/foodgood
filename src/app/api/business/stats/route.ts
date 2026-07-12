import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, json } from "@/shared/server/api";

/** Сводка мерчанта: выручка, комиссия платформы, спасённые пакеты. */
export async function GET() {
  return apiRoute(async () => {
    const user = await requireMerchant();
    const [completed, activePaid] = await Promise.all([
      prisma.order.aggregate({
        where: { bag: { venue: { ownerId: user.id } }, status: "COMPLETED" },
        _sum: { totalPrice: true, platformFee: true, quantity: true },
      }),
      prisma.order.count({
        where: { bag: { venue: { ownerId: user.id } }, status: "PAID" },
      }),
    ]);

    const gross = completed._sum.totalPrice ?? 0;
    const fees = completed._sum.platformFee ?? 0;
    const bagsSaved = completed._sum.quantity ?? 0;

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
