import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

/** Изменение остатка или снятие пакета с продажи. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const { id } = await params;
  const bag = await prisma.bag.findUnique({ where: { id }, include: { venue: true } });
  if (!bag || bag.venue.ownerId !== user.id) {
    return NextResponse.json({ error: "Пакет не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data: { quantityLeft?: number; status?: string } = {};

  if (body.quantityLeft !== undefined) {
    const qty = Math.round(Number(body.quantityLeft));
    if (!Number.isFinite(qty) || qty < 0) {
      return NextResponse.json({ error: "Некорректный остаток" }, { status: 400 });
    }
    data.quantityLeft = qty;
    data.status = qty === 0 ? "SOLD_OUT" : "ACTIVE";
  }
  if (body.status === "CANCELLED") data.status = "CANCELLED";

  const updated = await prisma.bag.update({ where: { id }, data, include: { venue: true } });
  return NextResponse.json({ bag: updated });
}
