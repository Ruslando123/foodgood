import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { expireStale } from "@/lib/orders";

/** Сводка мерчанта: выручка, комиссия платформы, спасённые пакеты. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  await expireStale();
  const completed = await prisma.order.findMany({
    where: { bag: { venue: { ownerId: user.id } }, status: "COMPLETED" },
    select: { totalPrice: true, platformFee: true, quantity: true },
  });
  const activePaid = await prisma.order.count({
    where: { bag: { venue: { ownerId: user.id } }, status: "PAID" },
  });

  const gross = completed.reduce((s, o) => s + o.totalPrice, 0);
  const fees = completed.reduce((s, o) => s + o.platformFee, 0);
  const bagsSaved = completed.reduce((s, o) => s + o.quantity, 0);

  return NextResponse.json({
    stats: {
      gross,               // всего продано, ₸
      fees,                // комиссия платформы, ₸
      net: gross - fees,   // к выплате заведению, ₸
      bagsSaved,           // выдано пакетов (спасено от списания)
      awaitingPickup: activePaid, // оплачено, ждут выдачи
    },
  });
}
