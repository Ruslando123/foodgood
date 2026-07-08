import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, normalizePhone, DEV_OTP_CODE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { phone, code } = await req.json().catch(() => ({}));
  const normalized = normalizePhone(String(phone ?? ""));
  if (!normalized) {
    return NextResponse.json({ error: "Некорректный номер телефона" }, { status: 400 });
  }
  if (String(code) !== DEV_OTP_CODE) {
    return NextResponse.json({ error: "Неверный код" }, { status: 401 });
  }

  const user = await prisma.user.upsert({
    where: { phone: normalized },
    update: {},
    create: { phone: normalized },
  });
  await createSession(user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
  });
}
