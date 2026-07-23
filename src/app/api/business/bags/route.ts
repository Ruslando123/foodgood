import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireBusinessAccess } from "@/modules/auth/business";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { dateValue, integer, optionalString, requiredString } from "@/shared/validation";
import { clientSourceFromRequest, recordProductEvent } from "@/lib/product-analytics";
import { parseSafetyAttestations, safetyAttestationData } from "@/lib/publication-safety";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const { owner } = await requireBusinessAccess();
    const bags = await prisma.bag.findMany({
      where: { venue: { ownerId: owner.id } },
      include: {
        venue: true,
        orders: {
          where: { status: { in: ["RESERVED", "READY_FOR_PICKUP", "COMPLETED"] } },
          orderBy: { createdAt: "desc" },
          take: 100,
        },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return json({ bags });
  });
}

/** Публикация пакета-сюрприза «в 2 клика». */
export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    const { actor, owner } = await requireBusinessAccess(req);
    const body = await readJsonObject(req);
    const safety = parseSafetyAttestations(body.safetyAttestations);
    const venueId = requiredString(body.venueId, "venueId", { max: 64 });
    const title = requiredString(body.title, "title", { max: 120 });
    const description = optionalString(body.description, "description", 1000);
    const composition = requiredString(body.composition, "composition", { min: 3, max: 1000 });
    const allergens = optionalString(body.allergens, "allergens", 300);
    const storage = requiredString(body.storage, "storage", { min: 3, max: 500 });
    const examplePhoto = optionalString(body.examplePhoto, "examplePhoto", 1000);
    const priceNum = integer(body.price, "price", { min: 1, max: 10_000_000 });
    const originalNum = integer(body.originalPrice, "originalPrice", {
      min: priceNum,
      max: 10_000_000,
    });
    const qty = integer(body.quantity, "quantity", { min: 1 });
    const start = dateValue(body.pickupStart, "pickupStart");
    const end = dateValue(body.pickupEnd, "pickupEnd");

    const venue = await prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue || venue.ownerId !== owner.id) {
      throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    }
    if (venue.status !== "ACTIVE") throw new ApiError(409, "VENUE_SUSPENDED", "Заведение приостановлено администратором");
    if (end <= start || end <= new Date()) {
      throw new ApiError(400, "INVALID_PICKUP_WINDOW", "Некорректное окно выдачи");
    }
    const bag = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Venue" WHERE id = ${venue.id} FOR UPDATE`;
      const lockedVenue = await tx.venue.findUnique({ where: { id: venue.id } });
      if (!lockedVenue || lockedVenue.ownerId !== owner.id) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
      if (lockedVenue.status !== "ACTIVE") throw new ApiError(409, "VENUE_SUSPENDED", "Заведение приостановлено администратором");
      const created = await tx.bag.create({
        data: {
          venueId: venue.id,
          title,
          description,
          composition,
          allergens,
          storage,
          examplePhoto,
          price: priceNum,
          originalPrice: originalNum,
          quantityTotal: qty,
          quantityLeft: qty,
          pickupStart: start,
          pickupEnd: end,
          ...safetyAttestationData(safety, actor.id),
        },
        include: { venue: true },
      });
      await tx.batchJob.create({
        data: {
          queue: "notifications",
          type: "FANOUT_NEW_BAG",
          dedupeKey: `fanout-new-bag:${created.id}`,
          payloadJson: JSON.stringify({ bagId: created.id }),
          nextAttemptAt: new Date(0),
        },
      });
      await recordProductEvent(tx, {
        name: "partner_offer_created",
        userId: actor.id,
        venueId: created.venueId,
        bagId: created.id,
        amount: created.price,
        quantity: created.quantityTotal,
        clientSource: clientSourceFromRequest(req),
        dedupeKey: `partner_offer_created:${created.id}`,
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: "BAG_PUBLISHED", entityType: "Bag", entityId: created.id, metadataJson: JSON.stringify({ venueId: venue.id, ownerId: owner.id, safetyAttestations: true }) },
      });
      return created;
    });
    return json({ bag }, { status: 201 });
  });
}
