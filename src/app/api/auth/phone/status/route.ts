import { NextRequest } from "next/server";
import { createSession } from "@/lib/auth";
import { consumeVerifiedMerchantLogin } from "@/lib/telegram-otp";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";

export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    await consumeRateLimit(`owner-login:poll:${requestIp(req)}`, { limit: 360, windowMs: 15 * 60 * 1000 });
    const { pollToken } = await readJsonObject(req);
    const result = await consumeVerifiedMerchantLogin(String(pollToken ?? ""));
    if (result.status === "PENDING") return json({ status: "PENDING" }, { status: 202 });
    if (result.status === "EXPIRED") {
      throw new ApiError(410, "LOGIN_REQUEST_EXPIRED", "Ссылка для входа устарела. Запросите новую");
    }
    if (result.user.status === "BLOCKED") throw new ApiError(403, "ACCOUNT_BLOCKED", "Аккаунт заблокирован администратором");
    if (result.user.status === "DEACTIVATED") throw new ApiError(403, "ACCOUNT_DEACTIVATED", "Аккаунт деактивирован");
    await createSession(result.user.id);
    return json({ status: "AUTHENTICATED", user: result.user });
  });
}
