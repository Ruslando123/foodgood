import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { expireStale } from "@/lib/orders";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  await expireStale();
  const bags = await prisma.bag.findMany({
    where: { venue: { ownerId: user.id } },
    include: { venue: true, orders: { where: { status: { in: ["PAID", "COMPLETED"] } } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ bags });
}

/** Публикация пакета-сюрприза «в 2 клика». */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { venueId, title, description, price, originalPrice, quantity, pickupStart, pickupEnd } = body;

  const venue = await prisma.venue.findUnique({ where: { id: String(venueId ?? "") } });
  if (!venue || venue.ownerId !== user.id) {
    return NextResponse.json({ error: "Заведение не найдено" }, { status: 404 });
  }

  const priceNum = Math.round(Number(price));
  const originalNum = Math.round(Number(originalPrice));
  const qty = Math.round(Number(quantity));
  const start = new Date(pickupStart);
  const end = new Date(pickupEnd);

  if (!title || !Number.isFinite(priceNum) || priceNum <= 0 || !Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "Заполните название, цену и количество" }, { status: 400 });
  }
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start || end <= new Date()) {
    return NextResponse.json({ error: "Некорректное окно выдачи" }, { status: 400 });
  }

  const bag = await prisma.bag.create({
    data: {
      venueId: venue.id,
      title: String(title),
      description: String(description ?? ""),
      price: priceNum,
      originalPrice: Number.isFinite(originalNum) && originalNum > priceNum ? originalNum : priceNum * 3,
      quantityTotal: qty,
      quantityLeft: qty,
      pickupStart: start,
      pickupEnd: end,
    },
    include: { venue: true },
  });
  return NextResponse.json({ bag }, { status: 201 });
}
