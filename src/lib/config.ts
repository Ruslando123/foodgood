export const CURRENCY = "₸";

export const VENUE_CATEGORIES: Record<string, string> = {
  CAFE: "Кофейня",
  BAKERY: "Пекарня",
  SUPERMARKET: "Супермаркет",
  RESTAURANT: "Ресторан",
};

// All supported venue categories can publish offers across Kazakhstan.
export const VENUE_CATEGORY_VALUES = ["CAFE", "BAKERY", "SUPERMARKET", "RESTAURANT"] as const;

export function isVenueCategory(category: string): boolean {
  return (VENUE_CATEGORY_VALUES as readonly string[]).includes(category);
}
