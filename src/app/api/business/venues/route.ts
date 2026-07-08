import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { VENUE_CATEGORIES } from "@/lib/config";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const venues = await prisma.venue.findMany({ where: { ownerId: user.id } });
  return NextResponse.json({ venues });
}

/** Регистрация заведения; пользователь при этом становится мерчантом. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, address, lat, lng, category, description, photo } = body;
  if (!name || !address || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return NextResponse.json(
      { error: "Нужны название, адрес и точка на карте" },
      { status: 400 }
    );
  }
  const cat = String(category ?? "CAFE");
  if (!(cat in VENUE_CATEGORIES)) {
    return NextResponse.json({ error: "Неизвестная категория" }, { status: 400 });
  }

  const [venue] = await prisma.$transaction([
    prisma.venue.create({
      data: {
        name: String(name),
        address: String(address),
        lat: Number(lat),
        lng: Number(lng),
        category: cat,
        description: String(description ?? ""),
        photo: String(photo ?? "🍽️"),
        ownerId: user.id,
      },
    }),
    prisma.user.update({ where: { id: user.id }, data: { role: "MERCHANT" } }),
  ]);
  return NextResponse.json({ venue }, { status: 201 });
}
