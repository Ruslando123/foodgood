import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { createOrder, expireStale, OrderError } from "@/lib/orders";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  await expireStale();
  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { bag: { include: { venue: true } }, payment: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const { bagId, quantity } = await req.json().catch(() => ({}));
  if (!bagId) return NextResponse.json({ error: "Не указан пакет" }, { status: 400 });

  try {
    const order = await createOrder(user.id, String(bagId), Number(quantity ?? 1));
    return NextResponse.json({ order }, { status: 201 });
  } catch (e) {
    if (e instanceof OrderError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
