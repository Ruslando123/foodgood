import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getSelectedAdminBusinessOwner } from "@/lib/admin-business-context";
import { ApiError } from "@/shared/server/api";
import { canAccessBusiness } from "./policy";
import { requireMerchant } from "./server";

export type BusinessAccess = {
  /** The signed-in user responsible for mutations and audit history. */
  actor: SessionUser;
  /** The merchant whose venues, bags, and orders are in scope. */
  owner: SessionUser;
};

export type OptionalBusinessAccess = {
  actor: SessionUser | null;
  owner: SessionUser | null;
};

/** Read-only variant for server-rendered business pages and layouts. */
export async function getBusinessAccess(): Promise<OptionalBusinessAccess> {
  const actor = await getSessionUser();
  if (!actor || !canAccessBusiness(actor.role)) return { actor: null, owner: null };
  if (actor.role === "MERCHANT") return { actor, owner: actor };
  return { actor, owner: await getSelectedAdminBusinessOwner(actor.id) };
}

export async function requireBusinessAccess(request?: Request): Promise<BusinessAccess> {
  const actor = await requireMerchant();
  if (actor.role === "MERCHANT") return { actor, owner: actor };

  const owner = await getSelectedAdminBusinessOwner(actor.id);
  if (!owner) {
    throw new ApiError(
      409,
      "BUSINESS_OWNER_SELECTION_REQUIRED",
      "Сначала выберите активного владельца в панели администратора"
    );
  }
  if (request && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    assertBusinessOwnerContext(request, owner.id);
  }
  return { actor, owner };
}

export function businessActorRole(actor: SessionUser): "ADMIN" | "PARTNER" {
  return actor.role === "ADMIN" ? "ADMIN" : "PARTNER";
}

export function assertBusinessOwnerContext(request: Request, ownerId: string): void {
  const expectedOwnerId = request.headers.get("X-FoodGood-Owner-Context");
  if (expectedOwnerId !== ownerId) {
    throw new ApiError(
      409,
      "BUSINESS_OWNER_CONTEXT_CHANGED",
      "Выбранный владелец изменился. Обновите страницу и повторите действие"
    );
  }
}
