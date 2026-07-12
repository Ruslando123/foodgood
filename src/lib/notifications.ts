import { prisma } from "@/lib/db";

/** Создаёт одно внутреннее напоминание за час до начала выдачи. */
export async function createPickupReminders(now = new Date()): Promise<number> {
  const pickupBefore = new Date(now.getTime() + 60 * 60_000);
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "READY_FOR_PICKUP"] },
      bag: { pickupStart: { gt: now, lte: pickupBefore } },
      user: { notificationReminders: true },
    },
    include: { bag: { include: { venue: true } } },
    take: 500,
  });
  if (!orders.length) return 0;
  const result = await prisma.notification.createMany({
    data: orders.map((order) => ({
      userId: order.userId,
      channel: "IN_APP",
      recipient: order.userId,
      type: "PICKUP_REMINDER",
      status: "SENT",
      sentAt: now,
      dedupeKey: `pickup-reminder:${order.id}`,
      payloadJson: JSON.stringify({ orderId: order.id, venueName: order.bag.venue.name, title: order.bag.title, pickupStart: order.bag.pickupStart }),
    })),
    skipDuplicates: true,
  });
  return result.count;
}
