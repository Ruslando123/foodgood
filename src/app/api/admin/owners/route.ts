import { NextRequest } from "next/server";
import { normalizePhone } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";

/** Список номеров, которым администратор уже выдал доступ владельца. */
export async function GET() {
  return apiRoute(async () => {
    await requireAdmin();
    const owners = await prisma.user.findMany({
      where: { role: "MERCHANT" },
      select: { id: true, phone: true, name: true, createdAt: true, _count: { select: { venues: true } } },
      orderBy: { createdAt: "desc" },
    });
    return json({ owners });
  });
}

/** Добавляет номер заранее: владелец сможет войти и сам создать заведение. */
export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const body = await readJsonObject(req);
    const phone = normalizePhone(requiredString(body.phone, "phone", { max: 30 }));
    if (!phone) throw new ApiError(400, "INVALID_OWNER_PHONE", "Некорректный номер телефона");

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing?.role === "ADMIN") throw new ApiError(409, "ADMIN_CANNOT_BE_OWNER", "Администратора нельзя назначить владельцем");
    if (existing?.role === "MERCHANT") throw new ApiError(409, "OWNER_EXISTS", "Этот номер уже добавлен как владелец");

    const [owner] = await prisma.$transaction([
      prisma.user.upsert({
        where: { phone },
        update: { role: "MERCHANT" },
        create: { phone, role: "MERCHANT" },
      }),
      prisma.auditLog.create({ data: { actorId: admin.id, action: "OWNER_GRANTED", entityType: "User", metadataJson: JSON.stringify({ phone }) } }),
    ]);
    return json({ owner }, { status: 201 });
  });
}
