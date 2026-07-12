import { prisma } from "@/lib/db";
import { destroySession } from "@/lib/auth";
import { requireUser } from "@/modules/auth/server";
import { apiRoute, assertSameOrigin, json } from "@/shared/server/api";

export async function POST(request: Request) {
  return apiRoute(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    await destroySession();
    return json({ ok: true });
  });
}
