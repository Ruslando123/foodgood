export type BusinessBagStatus = "ACTIVE" | "SOLD_OUT" | "INACTIVE" | "CANCELLED";

export function businessBagStatus(
  bag: { status: string; pickupEnd: Date; quantityLeft: number },
  now = new Date()
): BusinessBagStatus {
  if (bag.status === "CANCELLED") return "CANCELLED";
  if (bag.status === "EXPIRED" || bag.pickupEnd <= now) return "INACTIVE";
  if (bag.status === "SOLD_OUT" || bag.quantityLeft <= 0) return "SOLD_OUT";
  return "ACTIVE";
}

export const BUSINESS_BAG_STATUS_LABELS: Record<BusinessBagStatus, string> = {
  ACTIVE: "В продаже",
  SOLD_OUT: "Распродано",
  INACTIVE: "Неактивен",
  CANCELLED: "Снят с продажи",
};
