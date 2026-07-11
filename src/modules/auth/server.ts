import { getSessionUser, type SessionUser } from "@/lib/auth";
import { ApiError } from "@/shared/server/api";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Требуется вход");
  return user;
}

export async function requireMerchant(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "MERCHANT") {
    throw new ApiError(403, "MERCHANT_REQUIRED", "Доступно только заведению");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "Доступно только администратору");
  return user;
}
