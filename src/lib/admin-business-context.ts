import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sessionSecretValue } from "./secrets";
import { ApiError } from "@/shared/server/api";
import type { SessionUser } from "./auth";

const ADMIN_BUSINESS_COOKIE = "foodgood_admin_business";
const SESSION_COOKIE = "foodgood_session";
const ADMIN_BUSINESS_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_BUSINESS_ISSUER = "foodgood";
const ADMIN_BUSINESS_AUDIENCE = "admin-business";

function secret(): Uint8Array {
  return new TextEncoder().encode(sessionSecretValue());
}

async function sessionFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const ownerSelect = {
  id: true,
  phone: true,
  telegramId: true,
  name: true,
  role: true,
  status: true,
} as const;

async function activeMerchant(ownerId: string): Promise<SessionUser | null> {
  return prisma.user.findFirst({
    where: { id: ownerId, role: "MERCHANT", status: "ACTIVE" },
    select: ownerSelect,
  });
}

/**
 * Selects the merchant whose business an administrator is operating. The
 * signed cookie is bound to the current administrator, so it cannot be copied
 * to another admin session to inherit that admin's selection.
 */
export async function selectAdminBusinessOwner(adminId: string, ownerId: string): Promise<SessionUser> {
  const owner = await activeMerchant(ownerId);
  if (!owner) {
    throw new ApiError(404, "ACTIVE_OWNER_NOT_FOUND", "Активный владелец не найден");
  }

  const store = await cookies();
  const primarySession = store.get(SESSION_COOKIE)?.value;
  if (!primarySession) throw new ApiError(401, "AUTH_REQUIRED", "Требуется вход");
  const fingerprint = await sessionFingerprint(primarySession);

  const token = await new SignJWT({ ownerId, purpose: ADMIN_BUSINESS_AUDIENCE, sessionFingerprint: fingerprint })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuer(ADMIN_BUSINESS_ISSUER)
    .setAudience(ADMIN_BUSINESS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_BUSINESS_TTL_SECONDS}s`)
    .sign(secret());

  store.set(ADMIN_BUSINESS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_BUSINESS_TTL_SECONDS,
    path: "/",
  });
  return owner;
}

export async function clearAdminBusinessOwner(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_BUSINESS_COOKIE);
}

/** Returns null for a missing, forged, expired, reassigned, or blocked owner. */
export async function getSelectedAdminBusinessOwner(adminId: string): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(ADMIN_BUSINESS_COOKIE)?.value;
  const primarySession = store.get(SESSION_COOKIE)?.value;
  if (!token || !primarySession) return null;

  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: ADMIN_BUSINESS_ISSUER,
      audience: ADMIN_BUSINESS_AUDIENCE,
    });
    if (
      payload.sub !== adminId
      || payload.purpose !== ADMIN_BUSINESS_AUDIENCE
      || typeof payload.ownerId !== "string"
      || typeof payload.sessionFingerprint !== "string"
      || payload.sessionFingerprint !== await sessionFingerprint(primarySession)
    ) {
      return null;
    }
    return activeMerchant(payload.ownerId);
  } catch {
    return null;
  }
}
