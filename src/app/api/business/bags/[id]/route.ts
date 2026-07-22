import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { businessActorRole, requireBusinessAccess } from "@/modules/auth/business";
import { cancelBag, throwOrderApiError } from "@/modules/orders";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { dateValue, integer, optionalString, requiredString } from "@/shared/validation";
import { clientSourceFromRequest, recordProductEvent } from "@/lib/product-analytics";
import { parseSafetyAttestations, safetyAttestationData } from "@/lib/publication-safety";
import { assertVenueInPilotScope, getPilotConfig } from "@/lib/pilot";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(_req, async () => {
    const { owner } = await requireBusinessAccess(); const { id } = await params;
    const bag = await prisma.bag.findUnique({ where: { id }, include: { venue: true, _count: { select: { orders: true } } } });
    if (!bag || bag.venue.ownerId !== owner.id) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    return json({ bag });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const { actor, owner } = await requireBusinessAccess(req); const { id } = await params;
    const body = await readJsonObject(req);
    const safety = parseSafetyAttestations(body.safetyAttestations);
    const source = await prisma.bag.findUnique({ where: { id }, include: { venue: true } });
    if (!source || source.venue.ownerId !== owner.id) throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
    if (source.venue.status !== "ACTIVE") throw new ApiError(409, "VENUE_SUSPENDED", "Заведение приостановлено");
    assertVenueInPilotScope(source.venue);
    const pilot = getPilotConfig();
    const duration = source.pickupEnd.getTime() - source.pickupStart.getTime();
    const pickupStart = new Date(source.pickupStart); const now = new Date();
    do { pickupStart.setDate(pickupStart.getDate() + 1); } while (pickupStart <= now);
    const pickupEnd = new Date(pickupStart.getTime() + duration);
    const bag = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${source.venueId} FOR UPDATE`;
      const lockedVenue = await tx.venue.findUnique({ where: { id: source.venueId } });
      if (!lockedVenue || lockedVenue.ownerId !== owner.id) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
      if (lockedVenue.status !== "ACTIVE") throw new ApiError(409, "VENUE_SUSPENDED", "Заведение приостановлено");
      assertVenueInPilotScope(lockedVenue);
      const activeBagCount = await tx.bag.count({ where: { venueId: source.venueId, status: { in: ["ACTIVE", "SOLD_OUT"] }, pickupEnd: { gt: new Date() } } });
      if (activeBagCount >= pilot.limits.activeBagsPerVenue) throw new ApiError(409, "PILOT_BAG_LIMIT", `Для заведения доступно не более ${pilot.limits.activeBagsPerVenue} активных пакетов`);
      const created = await tx.bag.create({ data: { venueId: source.venueId, title: source.title, description: source.description, composition: source.composition || source.description, allergens: source.allergens, storage: source.storage || "Уточнить у продавца при получении", examplePhoto: source.examplePhoto, price: source.price, originalPrice: source.originalPrice, quantityTotal: source.quantityTotal, quantityLeft: source.quantityTotal, pickupStart, pickupEnd, ...safetyAttestationData(safety, actor.id) }, include: { venue: true } });
      await recordProductEvent(tx, {
        name: "partner_offer_created",
        userId: actor.id,
        venueId: created.venueId,
        bagId: created.id,
        amount: created.price,
        quantity: created.quantityTotal,
        clientSource: clientSourceFromRequest(req),
        dedupeKey: `partner_offer_created:${created.id}`,
        metadata: { repeatedFromBagId: source.id },
      });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "BAG_PUBLISHED", entityType: "Bag", entityId: created.id, metadataJson: JSON.stringify({ venueId: source.venueId, ownerId: owner.id, repeatedFromBagId: source.id, safetyAttestations: true }) } });
      return created;
    });
    return json({ bag }, { status: 201 });
  });
}

/**
 * Уменьшение остатка или снятие пакета с продажи с отменой активных броней.
 * Увеличение не разрешено: иначе можно повторно выставить уже зарезервированные
 * позиции и продать больше, чем было опубликовано.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return apiRoute(req, async () => {
    const { actor, owner } = await requireBusinessAccess(req);
    const { id } = await params;
    const body = await readJsonObject(req);

    if (body.status === "CANCELLED") {
      try {
        const reason = requiredString(body.reason, "reason", { min: 3, max: 500 });
        const bag = await cancelBag(owner.id, id, reason, actor.id, businessActorRole(actor));
        return json({ bag });
      } catch (error) {
        throwOrderApiError(error);
      }
    }

    if (body.quantityLeft === undefined) {
      if (body.action !== "details") throw new ApiError(400, "NO_CHANGES", "Нечего изменять");
      const safety = parseSafetyAttestations(body.safetyAttestations);
      const title = requiredString(body.title, "title", { max: 120 });
      const description = optionalString(body.description, "description", 1000);
      const composition = requiredString(body.composition, "composition", { min: 3, max: 1000 });
      const allergens = optionalString(body.allergens, "allergens", 300);
      const storage = requiredString(body.storage, "storage", { min: 3, max: 500 });
      const examplePhoto = optionalString(body.examplePhoto, "examplePhoto", 1000);
      const price = integer(body.price, "price", { min: 1, max: 10_000_000 });
      const originalPrice = integer(body.originalPrice, "originalPrice", { min: price, max: 10_000_000 });
      const pickupStart = dateValue(body.pickupStart, "pickupStart"); const pickupEnd = dateValue(body.pickupEnd, "pickupEnd");
      if (pickupEnd <= pickupStart || pickupEnd <= new Date()) throw new ApiError(400, "INVALID_PICKUP_WINDOW", "Некорректное окно выдачи");
      const current = await prisma.$transaction(async (tx) => {
        // createOrder acquires the same lock before reading price/window and
        // reserving inventory, so an edit and a purchase cannot interleave.
        await tx.$queryRaw`SELECT id FROM "Bag" WHERE id = ${id} FOR UPDATE`;
        const bag = await tx.bag.findUnique({ where: { id }, include: { venue: true } });
        if (!bag || bag.venue.ownerId !== owner.id) {
          throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
        }
        if (bag.status !== "ACTIVE" && bag.status !== "SOLD_OUT") {
          throw new ApiError(409, "BAG_NOT_EDITABLE", "Закрытый пакет нельзя редактировать");
        }
        const reserved = await tx.order.count({
          where: { bagId: id, status: { in: ["RESERVED", "READY_FOR_PICKUP", "COMPLETED"] } },
        });
        if (reserved && (price !== bag.price || pickupStart.getTime() !== bag.pickupStart.getTime() || pickupEnd.getTime() !== bag.pickupEnd.getTime())) {
          throw new ApiError(409, "BAG_HAS_ORDERS", "После первого заказа цену и время выдачи менять нельзя");
        }
        return tx.bag.update({
          where: { id },
          data: { title, description, composition, allergens, storage, examplePhoto, price, originalPrice, pickupStart, pickupEnd, ...safetyAttestationData(safety, actor.id) },
          include: { venue: true },
        });
      });
      return json({ bag: current });
    }
    const bag = await prisma.bag.findUnique({ where: { id }, include: { venue: true } });
    if (!bag || bag.venue.ownerId !== owner.id) {
      throw new ApiError(404, "BAG_NOT_FOUND", "Пакет не найден");
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
