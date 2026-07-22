import { NextRequest } from "next/server";
import { normalizePhone } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";

/** Список номеров, которым администратор уже выдал доступ владельца. */
export async function GET(request: NextRequest) {
  return apiRoute(request, async () => {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const query = (params.get("q") ?? "").trim();
    const requestedPage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const pageSize = 10;
    const where = { role: "MERCHANT", ...(query ? { OR: [{ phone: { contains: query } }, { name: { contains: query, mode: "insensitive" as const } }] } : {}) };
    const total = await prisma.user.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pages);
    const owners = await prisma.user.findMany({
      where,
      select: { id: true, phone: true, name: true, createdAt: true, _count: { select: { venues: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return json({ owners, page, pages, total });
  });
}

/** Добавляет номер заранее: владелец сможет войти и сам создать заведение. */
export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    const admin = await requireAdmin();
    const body = await readJsonObject(req);
    const phone = normalizePhone(requiredString(body.phone, "phone", { max: 30 }));
    if (!phone) throw new ApiError(400, "INVALID_OWNER_PHONE", "Некорректный номер телефона");

    const owner = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { phone },
        select: { id: true, role: true },
      });
      if (existing?.role === "MERCHANT") {
        throw new ApiError(409, "OWNER_EXISTS", "Этот номер уже добавлен как владелец");
      }

      const updated = await tx.user.upsert({
        where: { phone },
        update: {
          role: "MERCHANT",
          // Immediately revoke sessions that still carry the previous role.
          sessionVersion: { increment: 1 },
        },
        create: { phone, role: "MERCHANT" },
        select: { id: true, phone: true, name: true, role: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "OWNER_GRANTED",
          entityType: "User",
          entityId: updated.id,
          metadataJson: JSON.stringify({ phone, previousRole: existing?.role ?? null }),
        },
      });
      return updated;
    });
    return json({ owner }, { status: 201 });
  });
}
