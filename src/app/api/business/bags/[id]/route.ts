import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { cancelBagWithRefunds, throwOrderApiError } from "@/modules/orders";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { dateValue, integer, optionalString, requiredString } from "@/shared/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(_req, async () => {
    const user = await requireMerchant(); const { id } = await params;
    const bag = await prisma.bag.findUnique({ where: { id }, include: { venue: true, _count: { select: { orders: true } } } });
    if (!bag || bag.venue.ownerId !== user.id) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    return json({ bag });
  });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(_req, async () => {
    const user = await requireMerchant(); const { id } = await params;
    const source = await prisma.bag.findUnique({ where: { id }, include: { venue: true } });
    if (!source || source.venue.ownerId !== user.id) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    if (source.venue.status !== "ACTIVE") throw new ApiError(409, "VENUE_SUSPENDED", "Заведение приостановлено");
    const duration = source.pickupEnd.getTime() - source.pickupStart.getTime();
    const pickupStart = new Date(source.pickupStart); const now = new Date();
    do { pickupStart.setDate(pickupStart.getDate() + 1); } while (pickupStart <= now);
    const pickupEnd = new Date(pickupStart.getTime() + duration);
    const bag = await prisma.bag.create({ data: { venueId: source.venueId, title: source.title, description: source.description, price: source.price, originalPrice: source.originalPrice, quantityTotal: source.quantityTotal, quantityLeft: source.quantityTotal, pickupStart, pickupEnd }, include: { venue: true } });
    return json({ bag }, { status: 201 });
  });
}

/**
 * Уменьшение остатка или снятие пакета с продажи (с возвратом денег покупателям).
 * Увеличение не разрешено: иначе можно повторно выставить уже зарезервированные
 * позиции и продать больше, чем было опубликовано.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(req, async () => {
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
      if (body.action !== "details") throw new ApiError(400, "NO_CHANGES", "Нечего изменять");
      if (bag.status !== "ACTIVE" && bag.status !== "SOLD_OUT") throw new ApiError(409, "BAG_NOT_EDITABLE", "Закрытый пакет нельзя редактировать");
      const title = requiredString(body.title, "title", { max: 120 });
      const description = optionalString(body.description, "description", 1000);
      const price = integer(body.price, "price", { min: 1, max: 10_000_000 });
      const originalPrice = integer(body.originalPrice, "originalPrice", { min: price, max: 10_000_000 });
      const pickupStart = dateValue(body.pickupStart, "pickupStart"); const pickupEnd = dateValue(body.pickupEnd, "pickupEnd");
      if (pickupEnd <= pickupStart || pickupEnd <= new Date()) throw new ApiError(400, "INVALID_PICKUP_WINDOW", "Некорректное окно выдачи");
      const reserved = await prisma.order.count({ where: { bagId: id, status: { in: ["PENDING_PAYMENT", "PAID", "CAPTURE_PENDING", "COMPLETED"] } } });
      if (reserved && (price !== bag.price || pickupStart.getTime() !== bag.pickupStart.getTime() || pickupEnd.getTime() !== bag.pickupEnd.getTime())) throw new ApiError(409, "BAG_HAS_ORDERS", "После первого заказа цену и время выдачи менять нельзя");
      const current = await prisma.bag.update({ where: { id }, data: { title, description, price, originalPrice, pickupStart, pickupEnd }, include: { venue: true } });
      return json({ bag: current });
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
    // Optimistic concurrency: не затираем резерв покупателя абсолютным
    // значением, которое мерчант увидел до параллельной покупки.
    const updated = await prisma.bag.updateMany({
      where: { id, quantityLeft: bag.quantityLeft, status: bag.status },
      data: { quantityLeft: qty, status: qty === 0 ? "SOLD_OUT" : "ACTIVE" },
    });
    if (updated.count === 0) {
      throw new ApiError(409, "BAG_CHANGED", "Остаток изменился, обновите данные и повторите действие");
    }
    const current = await prisma.bag.findUniqueOrThrow({ where: { id }, include: { venue: true } });
    return json({ bag: current });
  });
}
