import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, normalizePhone, DEV_OTP_CODE, isDevOtpEnabled } from "@/lib/auth";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";

export async function POST(req: NextRequest) {
  return apiRoute(async () => {
    if (!isDevOtpEnabled()) {
      throw new ApiError(
        503,
        "PHONE_AUTH_NOT_CONFIGURED",
        "Вход по телефону временно недоступен"
      );
    }
    const { phone, code } = await readJsonObject(req);
    const normalized = normalizePhone(String(phone ?? ""));
    if (!normalized) {
      throw new ApiError(400, "INVALID_PHONE", "Некорректный номер телефона");
    }
    consumeRateLimit(`otp:verify:${requestIp(req)}:${normalized}`, {
      limit: 8,
      windowMs: 15 * 60 * 1000,
    });
    if (String(code) !== DEV_OTP_CODE) {
      throw new ApiError(401, "INVALID_OTP", "Неверный код");
    }

    const user = await prisma.user.upsert({
      where: { phone: normalized },
      update: {},
      create: { phone: normalized },
    });
    await createSession(user.id);
    return json({
      ok: true,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    });
  });
}
