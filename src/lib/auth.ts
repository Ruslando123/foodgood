import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sessionSecretValue } from "./secrets";

const SESSION_COOKIE = "foodgood_session";
const ADMIN_BUSINESS_COOKIE = "foodgood_admin_business";
const SESSION_TTL_DAYS = 30;

// Локальная заглушка. В production код доставляет Telegram-бот после
// проверки системного контакта пользователя.
export const DEV_OTP_CODE = "0000";

export function isLocalAppBaseUrl(value = process.env.APP_BASE_URL): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

/**
 * Production can expose the deterministic demo OTP only inside the isolated
 * local rehearsal. Each switch is required so copying one staging variable to
 * an externally reachable deployment cannot enable the fallback.
 */
export function isLocalRehearsalDevOtpEnabled(): boolean {
  return process.env.FOODGOOD_E2E_DEV_OTP === "true"
    && process.env.FOODGOOD_LOCAL_REHEARSAL === "true"
    && isLocalAppBaseUrl();
}

/**
 * Заглушка допустима только локально или в тестовом окружении. В production
 * телефонный вход должен быть подключён к Telegram OTP: иначе любой, кто
 * знает номер, получает доступ к аккаунту.
 */
export function isDevOtpEnabled(): boolean {
  return (process.env.NODE_ENV !== "production" || isLocalRehearsalDevOtpEnabled())
    && process.env.FOODGOOD_DISABLE_DEV_OTP !== "true";
}

function secret(): Uint8Array {
  return new TextEncoder().encode(sessionSecretValue());
}

export type SessionUser = {
  id: string;
  phone: string | null;
  telegramId: string | null;
  name: string | null;
  role: string;
  status: string;
};

export async function createSession(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
  const token = await new SignJWT({ sub: userId, ver: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  // A selected merchant belongs to one exact administrator login and must not
  // survive account switching or a fresh login.
  store.delete(ADMIN_BUSINESS_COOKIE);
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
  store.delete(ADMIN_BUSINESS_COOKIE);
}

export async function getSessionUser(options: { includeBlocked?: boolean } = {}): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return null;
    if (typeof payload.ver !== "number" || payload.ver !== user.sessionVersion) return null;
    // Pages use the safe default and cannot render private data for an account
    // blocked after its session was issued. API guards include the record so
    // they can return a specific ACCOUNT_BLOCKED response.
    if (user.status !== "ACTIVE" && !options.includeBlocked) return null;
    return {
      id: user.id,
      phone: user.phone,
      telegramId: user.telegramId,
      name: user.name,
      role: user.role,
      status: user.status,
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
