import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { expireStale } from "@/lib/orders";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  await expireStale();
  const orders = await prisma.order.findMany({
    where: { bag: { venue: { ownerId: user.id } } },
    include: { bag: { include: { venue: true } }, payment: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ orders });
}
