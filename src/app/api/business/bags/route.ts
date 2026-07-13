import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { dateValue, integer, optionalString, requiredString } from "@/shared/validation";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await requireMerchant();
    const bags = await prisma.bag.findMany({
      where: { venue: { ownerId: user.id } },
      include: {
        venue: true,
        orders: { where: { status: { in: ["PAID", "READY_FOR_PICKUP", "CAPTURE_PENDING", "COMPLETED"] } } },
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
    const user = await requireMerchant();
    const body = await readJsonObject(req);
    const venueId = requiredString(body.venueId, "venueId", { max: 64 });
    const title = requiredString(body.title, "title", { max: 120 });
    const description = optionalString(body.description, "description", 1000);
    const priceNum = integer(body.price, "price", { min: 1, max: 10_000_000 });
    const originalNum = integer(body.originalPrice, "originalPrice", {
      min: priceNum,
      max: 10_000_000,
    });
    const qty = integer(body.quantity, "quantity", { min: 1, max: 10_000 });
    const start = dateValue(body.pickupStart, "pickupStart");
    const end = dateValue(body.pickupEnd, "pickupEnd");

    const venue = await prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue || venue.ownerId !== user.id) {
      throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    }
    if (venue.status !== "ACTIVE") throw new ApiError(409, "VENUE_SUSPENDED", "Заведение приостановлено администратором");
    if (end <= start || end <= new Date()) {
      throw new ApiError(400, "INVALID_PICKUP_WINDOW", "Некорректное окно выдачи");
    }

    const bag = await prisma.$transaction(async (tx) => {
      const created = await tx.bag.create({
        data: {
          venueId: venue.id,
          title,
          description,
          price: priceNum,
          originalPrice: originalNum,
          quantityTotal: qty,
          quantityLeft: qty,
          pickupStart: start,
          pickupEnd: end,
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
      return created;
    });
    return json({ bag }, { status: 201 });
  });
}
