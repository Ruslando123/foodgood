export const CURRENCY = "₸";
export const PARTNER_AGREEMENT_VERSION = "PAY_AT_VENUE_PARTNER_2026-07-19";

export const VENUE_CATEGORIES: Record<string, string> = {
  CAFE: "Кофейня",
  BAKERY: "Пекарня",
  SUPERMARKET: "Супермаркет",
  RESTAURANT: "Ресторан",
};

// The closed pilot intentionally starts with prepared-food venues. Grocery
// retail remains modelled for existing data but cannot publish pilot offers.
export const PILOT_CATEGORY_ALLOWLIST = ["CAFE", "BAKERY", "RESTAURANT"] as const;

export function isPilotCategoryAllowed(category: string): boolean {
  return (PILOT_CATEGORY_ALLOWLIST as readonly string[]).includes(category);
}
