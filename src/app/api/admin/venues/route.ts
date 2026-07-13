import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server";
import { apiRoute, json } from "@/shared/server/api";

export async function GET(request: NextRequest) {
  return apiRoute(request, async () => {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const query = (params.get("q") ?? "").trim();
    const status = params.get("status");
    const requestedPage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const pageSize = 10;
    const where = {
      ...(status === "ACTIVE" || status === "SUSPENDED" ? { status } : {}),
      ...(query ? { OR: [
        { name: { contains: query, mode: "insensitive" as const } },
        { address: { contains: query, mode: "insensitive" as const } },
        { owner: { is: { name: { contains: query, mode: "insensitive" as const } } } },
        { owner: { is: { phone: { contains: query } } } },
      ] } : {}),
    };
    const total = await prisma.venue.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pages);
    const venues = await prisma.venue.findMany({
      where,
      include: {
        owner: { select: { phone: true, name: true } },
        bags: { where: { status: "ACTIVE" }, select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return json({ venues, page, pages, total });
  });
}
