import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";

export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null, stats: { bagsSaved: 0, moneySaved: 0 } });
    const [stats] = await prisma.$queryRaw<Array<{ bagsSaved: bigint; moneySaved: bigint }>>`
      SELECT
        COALESCE(SUM(o."quantity"), 0)::bigint AS "bagsSaved",
        COALESCE(SUM((b."originalPrice" - b."price") * o."quantity"), 0)::bigint AS "moneySaved"
      FROM "Order" o
      JOIN "Bag" b ON b."id" = o."bagId"
      WHERE o."userId" = ${user.id} AND o."status" = 'COMPLETED'
    `;
    return NextResponse.json({ user, stats: { bagsSaved: Number(stats.bagsSaved), moneySaved: Number(stats.moneySaved) } });
  });
}

export async function PATCH(request: Request) {
  return apiRoute(request, async () => {
    const session = await requireUser();
    const body = await readJsonObject(request);
    const name = requiredString(body.name, "name", { min: 2, max: 80 });
    const user = await prisma.user.update({ where: { id: session.id }, data: { name } });
    return json({
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    });
  });
}
