import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, json } from "@/shared/server/api";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const status = params.get("status");
    const query = (params.get("q") ?? "").trim();
    const partners = await prisma.partnerBusiness.findMany({
      where: {
        ...(status && ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"].includes(status) ? { verificationStatus: status } : {}),
        ...(query ? { OR: [
          { legalName: { contains: query, mode: "insensitive" } },
          { businessIdentifier: { contains: query } },
          { contactName: { contains: query, mode: "insensitive" } },
          { owner: { is: { phone: { contains: query } } } },
        ] } : {}),
      },
      include: {
        owner: { select: { id: true, name: true, phone: true, _count: { select: { venues: true } } } },
        agreements: { orderBy: { acceptedAt: "desc" } },
      },
      orderBy: [{ verificationStatus: "asc" }, { updatedAt: "desc" }],
      take: 200,
    });
    return json({ partners });
  });
}
