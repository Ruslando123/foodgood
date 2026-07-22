import { getSessionUser, type SessionUser } from "@/lib/auth";
import { ApiError } from "@/shared/server/api";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser({ includeBlocked: true });
  if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Требуется вход");
  if (user.status === "BLOCKED") throw new ApiError(403, "ACCOUNT_BLOCKED", "Аккаунт заблокирован администратором");
  if (user.status === "DEACTIVATED") throw new ApiError(403, "ACCOUNT_DEACTIVATED", "Аккаунт деактивирован");
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
