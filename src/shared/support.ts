export const COMPLAINT_CATEGORIES = [
  "VENUE_CLOSED",
  "ORDER_MISSING",
  "POOR_QUALITY",
  "WRONG_CONTENT",
  "OTHER",
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  VENUE_CLOSED: "Заведение закрыто",
  ORDER_MISSING: "Заказ отсутствует",
  POOR_QUALITY: "Плохое качество",
  WRONG_CONTENT: "Неправильный состав",
  OTHER: "Другое",
};

export function isComplaintCategory(value: unknown): value is ComplaintCategory {
  return typeof value === "string" && COMPLAINT_CATEGORIES.includes(value as ComplaintCategory);
}
