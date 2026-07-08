import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { cancelOrder, OrderError } from "@/lib/orders";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const { id } = await params;
  try {
    const order = await cancelOrder(user.id, id);
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof OrderError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
