import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/auth";
import { VENUE_CATEGORIES } from "@/lib/config";
import { nearestKazakhstanCity } from "@/lib/kazakhstan";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { finiteNumber, optionalString, requiredString } from "@/shared/validation";
import { assertVenueInPilotScope, enforcePilotVenueCapacity } from "@/lib/pilot";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(_request, async () => {
    await requireAdmin();
    const { id } = await params;
    const venue = await prisma.venue.findUnique({ where: { id }, include: { owner: true } });
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    return json({ venue });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const existing = await prisma.venue.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");

    const body = await readJsonObject(req);
    if (body.action === "moderate") {
      const status = requiredString(body.status, "status", { max: 20 });
      if (status !== "ACTIVE" && status !== "SUSPENDED") {
        throw new ApiError(400, "UNKNOWN_VENUE_STATUS", "Неизвестный статус заведения");
      }
      const suspensionReason = status === "SUSPENDED"
        ? requiredString(body.suspensionReason, "suspensionReason", { max: 500 })
        : null;
      if (status === "ACTIVE") assertVenueInPilotScope(existing);
      const venue = await prisma.$transaction(async (tx) => {
        if (status === "ACTIVE") await enforcePilotVenueCapacity(tx, id);
        const updated = await tx.venue.update({ where: { id }, data: { status, suspensionReason } });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: status === "ACTIVE" ? "VENUE_ACTIVATED" : "VENUE_SUSPENDED",
            entityType: "Venue",
            entityId: id,
            metadataJson: JSON.stringify({ suspensionReason }),
          },
        });
        return updated;
      });
      return json({ venue });
    }
    const name = requiredString(body.name, "name", { max: 120 });
    const address = requiredString(body.address, "address", { max: 300 });
    const category = requiredString(body.category ?? "CAFE", "category", { max: 40 });
    if (!(category in VENUE_CATEGORIES)) throw new ApiError(400, "UNKNOWN_VENUE_CATEGORY", "Неизвестная категория");
    const phone = normalizePhone(requiredString(body.ownerPhone, "ownerPhone", { max: 30 }));
    if (!phone) throw new ApiError(400, "INVALID_OWNER_PHONE", "Некорректный телефон владельца");
    const owner = await prisma.user.findUnique({ where: { phone } });
    if (!owner) throw new ApiError(404, "OWNER_NOT_FOUND", "Пользователь не найден. Попросите владельца сначала войти в приложение.");
    if (owner.role === "ADMIN") throw new ApiError(409, "ADMIN_CANNOT_BE_OWNER", "Администратора нельзя назначить владельцем");
    const lat = finiteNumber(body.lat, "lat", { min: -90, max: 90 });
    const lng = finiteNumber(body.lng, "lng", { min: -180, max: 180 });
    const cityId = nearestKazakhstanCity(lat, lng).id;
    assertVenueInPilotScope({ cityId, category, lat, lng });

    const venue = await prisma.$transaction(async (tx) => {
      if (existing.status === "ACTIVE") await enforcePilotVenueCapacity(tx, id);
      const updated = await tx.venue.update({
        where: { id },
        data: {
          name,
          address,
          category,
          ownerId: owner.id,
          lat,
          lng,
          cityId,
          description: optionalString(body.description, "description", 1000),
          photo: optionalString(body.photo, "photo", 200) || "🍽️",
        },
      });
      if (owner.role === "CUSTOMER") await tx.user.update({ where: { id: owner.id }, data: { role: "MERCHANT" } });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "VENUE_UPDATED", entityType: "Venue", entityId: id, metadataJson: JSON.stringify({ ownerId: owner.id }) } });
      return updated;
    });
    return json({ venue });
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(_request, async () => {
    await requireAdmin();
    const { id } = await params;
    const venue = await prisma.venue.findUnique({ where: { id }, include: { bags: { include: { orders: true } } } });
    if (!venue) throw new ApiError(404, "VENUE_NOT_FOUND", "Заведение не найдено");
    if (venue.bags.some((bag) => bag.orders.length > 0)) {
      throw new ApiError(409, "VENUE_HAS_ORDERS", "Нельзя удалить заведение с заказами; сначала отмените или архивируйте пакеты");
    }
    await prisma.venue.delete({ where: { id } });
    return json({ ok: true });
  });
}
