import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, json } from "@/shared/server/api";

export async function GET() {
  return apiRoute(async () => {
    await requireAdmin();
    const venues = await prisma.venue.findMany({
      include: {
        owner: { select: { phone: true, name: true } },
        bags: { where: { status: "ACTIVE" }, select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return json({ venues });
  });
}
