import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/auth";

/**
 * Запрос кода подтверждения. В MVP SMS не отправляется — код всегда 0000.
 * Здесь же в продакшене подключается SMS-шлюз.
 */
export async function POST(req: NextRequest) {
  const { phone } = await req.json().catch(() => ({}));
  const normalized = normalizePhone(String(phone ?? ""));
  if (!normalized) {
    return NextResponse.json({ error: "Некорректный номер телефона" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, phone: normalized });
}
