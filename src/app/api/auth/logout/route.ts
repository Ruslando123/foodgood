import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { apiRoute, assertSameOrigin } from "@/shared/server/api";

export async function POST(request: Request) {
  return apiRoute(request, async () => {
    assertSameOrigin(request);
    await destroySession();
    return NextResponse.json({ ok: true });
  });
}
