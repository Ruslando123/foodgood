import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}

export async function PATCH(request: Request) {
  return apiRoute(async () => {
    const session = await requireUser();
    const body = await readJsonObject(request);
    const name = requiredString(body.name, "name", { min: 2, max: 80 });
    const user = await prisma.user.update({ where: { id: session.id }, data: { name } });
    return json({
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    });
  });
}
