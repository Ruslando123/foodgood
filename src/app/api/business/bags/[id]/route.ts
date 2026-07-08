import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { cancelBagWithRefunds, OrderError } from "@/lib/orders";

/** Изменение остатка или снятие пакета с продажи (с возвратом денег покупателям). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    if (body.status === "CANCELLED") {
      const bag = await cancelBagWithRefunds(user.id, id);
      return NextResponse.json({ bag });
    }

    const bag = await prisma.bag.findUnique({ where: { id }, include: { venue: true } });
    if (!bag || bag.venue.ownerId !== user.id) {
      return NextResponse.json({ error: "Пакет не найден" }, { status: 404 });
    }

    if (body.quantityLeft === undefined) {
      return NextResponse.json({ error: "Нечего изменять" }, { status: 400 });
    }
    const qty = Math.round(Number(body.quantityLeft));
    if (!Number.isFinite(qty) || qty < 0) {
      return NextResponse.json({ error: "Некорректный остаток" }, { status: 400 });
    }
    const updated = await prisma.bag.update({
      where: { id },
      data: { quantityLeft: qty, status: qty === 0 ? "SOLD_OUT" : "ACTIVE" },
      include: { venue: true },
    });
    return NextResponse.json({ bag: updated });
  } catch (e) {
    if (e instanceof OrderError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
