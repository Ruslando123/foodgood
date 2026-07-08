import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { bag: { include: { venue: true } }, payment: true },
  });
  if (!order || order.userId !== user.id) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }
  return NextResponse.json({ order });
}
