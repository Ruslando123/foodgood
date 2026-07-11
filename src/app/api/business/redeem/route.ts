import { NextRequest } from "next/server";
import { requireMerchant } from "@/modules/auth/server";
import { redeemOrder, throwOrderApiError } from "@/modules/orders";
import { apiRoute, json, readJsonObject } from "@/shared/server/api";
import { requiredString } from "@/shared/validation";

/** Выдача заказа на кассе: сканирование/ввод pickup-кода. */
export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    const user = await requireMerchant();
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
