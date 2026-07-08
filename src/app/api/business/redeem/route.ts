import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { redeemOrder, OrderError } from "@/lib/orders";

/** Выдача заказа на кассе: сканирование/ввод pickup-кода. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const { code } = await req.json().catch(() => ({}));
  if (!code) return NextResponse.json({ error: "Введите код" }, { status: 400 });

  try {
    const order = await redeemOrder(user.id, String(code));
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof OrderError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
