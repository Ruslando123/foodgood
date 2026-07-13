import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json } from "@/shared/server/api";

/** Отзывает доступ владельца, но не удаляет историю заказов пользователя. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(_req, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const owner = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { venues: true } } } });
    if (!owner || owner.role !== "MERCHANT") throw new ApiError(404, "OWNER_NOT_FOUND", "Владелец не найден");
    if (owner._count.venues > 0) throw new ApiError(409, "OWNER_HAS_VENUES", "Сначала переназначьте или удалите заведения владельца");

    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { role: "CUSTOMER" } }),
      prisma.auditLog.create({ data: { actorId: admin.id, action: "OWNER_REVOKED", entityType: "User", entityId: id } }),
    ]);
    return json({ ok: true });
  });
}
