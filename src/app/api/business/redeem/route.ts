import { NextRequest } from "next/server";
import { requireMerchant } from "@/modules/auth/server";
import { redeemOrder, throwOrderApiError } from "@/modules/orders";
import { apiRoute, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit } from "@/shared/server/rate-limit";
import { requiredString } from "@/shared/validation";

/** Выдача заказа на кассе: сканирование/ввод pickup-кода. */
export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    const user = await requireMerchant();
    await consumeRateLimit(`order:redeem:${user.id}`, { limit: 30, windowMs: 60 * 1000 });
    const body = await readJsonObject(req);
    const code = requiredString(body.code, "code", { min: 6, max: 6 }).toUpperCase();
    try {
      const order = await redeemOrder(user.id, code);
      return json({ order });
    } catch (error) {
      throwOrderApiError(error);
    }
  });
}
