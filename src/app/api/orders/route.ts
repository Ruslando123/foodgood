import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { createOrder, customerOrderScopeWhere, throwOrderApiError } from "@/modules/orders";
import { idempotentOrderRequest, normalizeIdempotencyKey } from "@/modules/orders/idempotency";
import { apiRoute, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit } from "@/shared/server/rate-limit";
import { integer, requiredString } from "@/shared/validation";

export async function GET(request: NextRequest) {
  return apiRoute(request, async () => {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const scope = params.get("scope") === "history" ? "history" : "active";
    const cursor = params.get("cursor") || undefined;
    const requestedLimit = Number(params.get("limit") ?? 20);
    const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20;
    const orders = await prisma.order.findMany({
      where: customerOrderScopeWhere(user.id, scope),
      include: { bag: { include: { venue: true } }, payment: true, review: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const nextCursor = orders.length > limit ? orders.pop()!.id : null;
    return json({ orders, nextCursor });
  });
}

export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    const user = await requireUser();
    await consumeRateLimit(`order:create:${user.id}`, { limit: 10, windowMs: 60 * 1000 });
    const body = await readJsonObject(req);
    const bagId = requiredString(body.bagId, "bagId", { max: 64 });
    const quantity = integer(body.quantity ?? 1, "quantity", { min: 1, max: 10 });
    const idempotencyKey = normalizeIdempotencyKey(req.headers.get("idempotency-key"));
    try {
      const create = (idempotencyRecordId: string) =>
        createOrder(user.id, bagId, quantity, idempotencyRecordId);
      const order = await idempotentOrderRequest(
        `${user.id}:${idempotencyKey}`,
        `${bagId}:${quantity}`,
        create
      );
      return json({ order }, { status: 201 });
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
