export const COMPLAINT_CATEGORIES = [
  "VENUE_CLOSED",
  "ORDER_MISSING",
  "POOR_QUALITY",
  "WRONG_CONTENT",
  "FOOD_SAFETY",
  "OTHER",
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  VENUE_CLOSED: "Заведение закрыто",
  ORDER_MISSING: "Заказ отсутствует",
  POOR_QUALITY: "Плохое качество",
  WRONG_CONTENT: "Неправильный состав",
  FOOD_SAFETY: "Безопасность еды",
  OTHER: "Другое",
};

export const COMPLAINT_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "WAITING_FOR_PARTNER",
  "RESOLVED",
  "ESCALATED",
  "CLOSED",
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  OPEN: "Открыто",
  UNDER_REVIEW: "На рассмотрении",
  WAITING_FOR_PARTNER: "Ожидаем партнёра",
  RESOLVED: "Решено",
  ESCALATED: "Эскалировано",
  CLOSED: "Закрыто",
};

export function isComplaintStatus(value: unknown): value is ComplaintStatus {
  return typeof value === "string" && COMPLAINT_STATUSES.includes(value as ComplaintStatus);
}

export function isComplaintCategory(value: unknown): value is ComplaintCategory {
  return typeof value === "string" && COMPLAINT_CATEGORIES.includes(value as ComplaintCategory);
}
