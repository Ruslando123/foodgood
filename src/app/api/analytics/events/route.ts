import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientSourceFromRequest, recordProductEvent } from "@/lib/product-analytics";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { integer, requiredString } from "@/shared/validation";

const CLIENT_EVENTS = new Set(["offer_view", "reserve_started", "pickup_code_opened"] as const);
type ClientEventName = "offer_view" | "reserve_started" | "pickup_code_opened";

export async function POST(request: Request) {
  return apiRoute(request, async () => {
    const body = await readJsonObject(request);
    const name = requiredString(body.name, "name", { max: 40 });
    if (!CLIENT_EVENTS.has(name as ClientEventName)) throw new ApiError(400, "INVALID_EVENT", "Недопустимое клиентское событие");
    const eventName = name as ClientEventName;
    const anonymousId = requiredString(body.anonymousId, "anonymousId", { max: 80 });
    const clientEventId = requiredString(body.clientEventId, "clientEventId", { max: 80 });
    const user = await getSessionUser();
    const source = clientSourceFromRequest(request);

    if (eventName === "pickup_code_opened") {
      const orderId = requiredString(body.orderId, "orderId", { max: 64 });
      const order = await prisma.order.findUnique({ where: { id: orderId }, include: { bag: true } });
      if (!order || !user || order.userId !== user.id) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
      await recordProductEvent(prisma, {
        name: eventName,
        userId: user.id,
        anonymousId,
        venueId: order.bag.venueId,
        bagId: order.bagId,
        orderId: order.id,
        amount: order.totalPrice,
        quantity: order.quantity,
        clientSource: order.clientSource || source,
        dedupeKey: `client:${clientEventId}`,
      });
      return json({ tracked: true });
    }

    const bagId = requiredString(body.bagId, "bagId", { max: 64 });
    const quantity = integer(body.quantity ?? 1, "quantity", { min: 1, max: 10 });
    const bag = await prisma.bag.findUnique({ where: { id: bagId } });
    if (!bag) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    await recordProductEvent(prisma, {
      name: eventName,
      userId: user?.id,
      anonymousId,
      venueId: bag.venueId,
      bagId: bag.id,
      amount: bag.price * quantity,
      quantity,
      clientSource: source,
      dedupeKey: `client:${clientEventId}`,
    });
    return json({ tracked: true });
  });
}
