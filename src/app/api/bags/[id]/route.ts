import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { expireStale } from "@/lib/orders";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await expireStale();
  const { id } = await params;
  const bag = await prisma.bag.findUnique({
    where: { id },
    include: { venue: true },
  });
  if (!bag) return NextResponse.json({ error: "Пакет не найден" }, { status: 404 });
  return NextResponse.json({ bag });
}
