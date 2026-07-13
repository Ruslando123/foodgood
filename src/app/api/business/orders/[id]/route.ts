import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { markOrderReady, throwOrderApiError } from "@/modules/orders";
import { merchantOrderSelect, toMerchantOrderDto } from "@/modules/api/dto";

async function ownedOrder(ownerId: string, id: string) {
  const order = await prisma.order.findFirst({ where: { id, bag: { venue: { ownerId } } }, select: merchantOrderSelect });
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
  return order;
}
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return apiRoute(_req, async () => { const user = await requireMerchant(); const { id } = await params; return json({ order: toMerchantOrderDto(await ownedOrder(user.id, id)) }); }); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const user = await requireMerchant(); const { id } = await params; const body = await readJsonObject(req);
    if (body.action !== "ready") throw new ApiError(400, "UNKNOWN_ACTION", "Неизвестное действие");
    try {
      return json({ order: toMerchantOrderDto(await markOrderReady(user.id, id)) });
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
