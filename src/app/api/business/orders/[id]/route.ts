import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";

async function ownedOrder(ownerId: string, id: string) {
  const order = await prisma.order.findFirst({ where: { id, bag: { venue: { ownerId } } }, include: { user: true, payment: true, bag: { include: { venue: true } }, review: true } });
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
  return order;
}
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return apiRoute(_req, async () => { const user = await requireMerchant(); const { id } = await params; return json({ order: await ownedOrder(user.id, id) }); }); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const user = await requireMerchant(); const { id } = await params; const order = await ownedOrder(user.id, id); const body = await readJsonObject(req);
    if (body.action !== "ready") throw new ApiError(400, "UNKNOWN_ACTION", "Неизвестное действие");
    if (order.status !== "PAID") throw new ApiError(409, "ORDER_NOT_PAID", "Заказ нельзя отметить готовым");
    const updated = await prisma.$transaction(async (tx) => {
      const ready = await tx.order.update({ where: { id }, data: { status: "READY_FOR_PICKUP" }, include: { user: true, payment: true, bag: { include: { venue: true } } } });
      await tx.notification.upsert({
        where: { dedupeKey: `order-ready:${id}` },
        update: {},
        create: {
          userId: ready.userId,
          channel: "IN_APP",
          recipient: ready.userId,
          type: "ORDER_READY",
          status: "SENT",
          sentAt: new Date(),
          dedupeKey: `order-ready:${id}`,
          payloadJson: JSON.stringify({ orderId: id, venueName: ready.bag.venue.name, title: ready.bag.title }),
        },
      });
      return ready;
    });
    return json({ order: updated });
  });
}
