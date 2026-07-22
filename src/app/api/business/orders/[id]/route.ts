import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { businessActorRole, requireBusinessAccess } from "@/modules/auth/business";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { cancelOrderByPartner, markOrderReady, throwOrderApiError } from "@/modules/orders";
import { merchantOrderSelect, toMerchantOrderDto } from "@/modules/api/dto";
import { requiredString } from "@/shared/validation";

async function ownedOrder(ownerId: string, id: string) {
  const order = await prisma.order.findFirst({ where: { id, bag: { venue: { ownerId } } }, select: merchantOrderSelect });
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
  return order;
}
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return apiRoute(_req, async () => { const { owner } = await requireBusinessAccess(); const { id } = await params; return json({ order: toMerchantOrderDto(await ownedOrder(owner.id, id)) }); }); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const { actor, owner } = await requireBusinessAccess(req); const { id } = await params; const body = await readJsonObject(req);
    try {
      if (body.action === "ready") {
        return json({ order: toMerchantOrderDto(await markOrderReady(owner.id, id, actor.id, businessActorRole(actor))) });
      }
      if (body.action === "cancel") {
        const reason = requiredString(body.reason, "reason", { min: 3, max: 500 });
        return json({ order: toMerchantOrderDto(await cancelOrderByPartner(owner.id, id, reason, actor.id, businessActorRole(actor))) });
      }
      throw new ApiError(400, "UNKNOWN_ACTION", "Неизвестное действие");
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
