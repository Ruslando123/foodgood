import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/server";
import { createOrder, throwOrderApiError } from "@/modules/orders";
import { idempotentOrderRequest } from "@/modules/orders/idempotency";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit } from "@/shared/server/rate-limit";
import { integer, requiredString } from "@/shared/validation";

export async function GET() {
  return apiRoute(async () => {
    const user = await requireUser();
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      include: { bag: { include: { venue: true } }, payment: true },
      orderBy: { createdAt: "desc" },
    });
    return json({ orders });
  });
}

export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    const user = await requireUser();
    await consumeRateLimit(`order:create:${user.id}`, { limit: 10, windowMs: 60 * 1000 });
    const body = await readJsonObject(req);
    const bagId = requiredString(body.bagId, "bagId", { max: 64 });
    const quantity = integer(body.quantity ?? 1, "quantity", { min: 1, max: 10 });
    const idempotencyKey = req.headers.get("idempotency-key");
    if (idempotencyKey !== null && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
      throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Некорректный Idempotency-Key");
    }
    try {
      const create = (idempotencyRecordId?: string) =>
        createOrder(user.id, bagId, quantity, idempotencyRecordId);
      const order = idempotencyKey
        ? await idempotentOrderRequest(
            `${user.id}:${idempotencyKey}`,
            `${bagId}:${quantity}`,
            create
          )
        : await create();
      return json({ order }, { status: 201 });
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
