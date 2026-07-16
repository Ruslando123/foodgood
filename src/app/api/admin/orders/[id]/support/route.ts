import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { optionalString } from "@/shared/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await readJsonObject(req);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Заказ не найден");
    const resolution = optionalString(body.resolution, "resolution", 1000);
    const resolvedAt = new Date();
    const updated = await prisma.order.update({
      where: { id },
      data: { supportStatus: "RESOLVED", supportResolvedAt: resolvedAt, supportResolution: resolution },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "ORDER_SUPPORT_RESOLVED",
        entityType: "Order",
        entityId: id,
        metadataJson: JSON.stringify({ resolution, resolvedAt }),
      },
    });
    return json({ order: updated });
  });
}
