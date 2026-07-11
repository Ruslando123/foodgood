import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { cancelBagWithRefunds, throwOrderApiError } from "@/modules/orders";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { integer } from "@/shared/validation";

/**
 * Уменьшение остатка или снятие пакета с продажи (с возвратом денег покупателям).
 * Увеличение не разрешено: иначе можно повторно выставить уже зарезервированные
 * позиции и продать больше, чем было опубликовано.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(async () => {
    const user = await requireMerchant();
    const { id } = await params;
    const body = await readJsonObject(req);

    if (body.status === "CANCELLED") {
      try {
        const bag = await cancelBagWithRefunds(user.id, id);
        return json({ bag });
      } catch (error) {
        throwOrderApiError(error);
      }
    }

    const bag = await prisma.bag.findUnique({ where: { id }, include: { venue: true } });
    if (!bag || bag.venue.ownerId !== user.id) {
      throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    }
    if (body.quantityLeft === undefined) {
      throw new ApiError(400, "NO_CHANGES", "Нечего изменять");
    }
    if (bag.status !== "ACTIVE" && bag.status !== "SOLD_OUT") {
      throw new ApiError(409, "BAG_NOT_EDITABLE", "Отменённый или просроченный пакет нельзя вернуть в продажу");
    }
    if (bag.pickupEnd <= new Date()) {
      throw new ApiError(409, "PICKUP_WINDOW_ENDED", "Окно выдачи уже закончилось");
    }
    const qty = integer(body.quantityLeft, "quantityLeft", {
      min: 0,
      max: bag.quantityLeft,
    });
    const updated = await prisma.bag.update({
      where: { id },
      data: { quantityLeft: qty, status: qty === 0 ? "SOLD_OUT" : "ACTIVE" },
      include: { venue: true },
    });
    return json({ bag: updated });
  });
}
