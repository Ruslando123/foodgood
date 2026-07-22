import { prisma } from "@/lib/db";
import { requireBusinessAccess } from "@/modules/auth/business";
import { apiRoute, json } from "@/shared/server/api";

/** Сводка мерчанта: оборот на кассе, выдачи и активные брони. */
export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const { owner } = await requireBusinessAccess();
    const [completed, activePaid] = await Promise.all([
      prisma.order.aggregate({
        where: { bag: { venue: { ownerId: owner.id } }, status: "COMPLETED" },
        _sum: { totalPrice: true, quantity: true },
      }),
      prisma.order.count({
        where: { bag: { venue: { ownerId: owner.id } }, status: { in: ["RESERVED", "READY_FOR_PICKUP"] } },
      }),
    ]);

    const gross = completed._sum.totalPrice ?? 0;
    const bagsSaved = completed._sum.quantity ?? 0;

    return json({
      stats: {
        gross,
        bagsSaved,
        awaitingPickup: activePaid,
      },
    });
  });
}
