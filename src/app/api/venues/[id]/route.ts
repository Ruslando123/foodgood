import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { expireStale } from "@/lib/orders";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await expireStale();
  const { id } = await params;
  const venue = await prisma.venue.findUnique({
    where: { id },
    include: {
      bags: {
        where: { status: "ACTIVE", quantityLeft: { gt: 0 } },
        orderBy: { pickupEnd: "asc" },
      },
    },
  });
  if (!venue) return NextResponse.json({ error: "Заведение не найдено" }, { status: 404 });
  return NextResponse.json({ venue });
}
