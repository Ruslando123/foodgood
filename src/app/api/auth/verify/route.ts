import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, normalizePhone } from "@/lib/auth";
import { consumeOtp, OtpError } from "@/lib/otp";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";
import { consumeRateLimit, requestIp } from "@/shared/server/rate-limit";
import { attachTelegramAfterOtp } from "@/lib/telegram-otp";

export async function POST(req: NextRequest) {
  return apiRoute(req, async () => {
    const { phone, code } = await readJsonObject(req);
    const normalized = normalizePhone(String(phone ?? ""));
    if (!normalized) {
      throw new ApiError(400, "INVALID_PHONE", "Некорректный номер телефона");
    }
    await consumeRateLimit(`otp:verify:${requestIp(req)}:${normalized}`, {
      limit: 8,
      windowMs: 15 * 60 * 1000,
    });
    try {
      await consumeOtp(normalized, String(code ?? ""));
    } catch (error) {
      if (error instanceof OtpError) {
        throw new ApiError(error.code === "OTP_RATE_LIMITED" ? 429 : 401, error.code, error.message);
      }
      throw error;
    }

    // Номер администратора хранится вне кода. Это позволяет выдать доступ
    // конкретному владельцу проекта без отдельной формы регистрации.
    const isAdminPhone = normalized === normalizePhone(process.env.ADMIN_PHONE ?? "");
    const user = await prisma.user.upsert({
      where: { phone: normalized },
      update: isAdminPhone ? { role: "ADMIN" } : {},
      create: { phone: normalized, role: isAdminPhone ? "ADMIN" : "CUSTOMER" },
    });
    if (user.status === "BLOCKED") {
      throw new ApiError(403, "ACCOUNT_BLOCKED", "Аккаунт заблокирован администратором");
    }
    await attachTelegramAfterOtp(normalized, user.id);
    await createSession(user.id);
    return json({
      ok: true,
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
    });
  });
}
