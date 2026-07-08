import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";

const SESSION_COOKIE = "foodgood_session";
const SESSION_TTL_DAYS = 30;

// В MVP код подтверждения — заглушка. Реальный SMS-шлюз (Mobizon/SMSC)
// подключается здесь же, не трогая остальной код.
export const DEV_OTP_CODE = "0000";

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) {
    // Тихий дефолт в проде означал бы подделываемые сессии
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    return new TextEncoder().encode("dev-secret-change-in-production");
  }
  return new TextEncoder().encode(raw);
}

export type SessionUser = {
  id: string;
  phone: string | null;
  telegramId: string | null;
  name: string | null;
  role: string;
};

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return null;
    return {
      id: user.id,
      phone: user.phone,
      telegramId: user.telegramId,
      name: user.name,
      role: user.role,
    };
  } catch {
    return null;
  }
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  // Казахстанские номера: 7XXXXXXXXXX (11 цифр), допускаем ввод с 8
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return "+7" + digits.slice(1);
  }
  if (digits.length === 10) return "+7" + digits;
  return null;
}
