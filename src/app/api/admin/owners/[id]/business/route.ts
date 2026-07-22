import { NextRequest } from "next/server";
import { selectAdminBusinessOwner } from "@/lib/admin-business-context";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, json } from "@/shared/server/api";

/** Selects an active merchant whose business dashboard the admin will operate. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(req, async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const owner = await selectAdminBusinessOwner(admin.id, id);
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "ADMIN_BUSINESS_OWNER_SELECTED",
        entityType: "User",
        entityId: owner.id,
      },
    });
    return json({
      owner: {
        id: owner.id,
        name: owner.name,
        phone: owner.phone,
        status: owner.status,
      },
    });
  });
}
