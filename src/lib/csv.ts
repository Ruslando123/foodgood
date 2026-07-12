import { ApiError } from "@/shared/server/api";

export function csvCell(value: string | number | Date | null): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function parseFinanceDateRange(url: string, now = new Date()): { from: Date; toExclusive: Date; label: string } {
  const params = new URL(url).searchParams;
  const defaultTo = dateLabel(now);
  const defaultFrom = dateLabel(new Date(now.getTime() - 89 * 24 * 60 * 60_000));
  const fromLabel = params.get("from") || defaultFrom;
  const toLabel = params.get("to") || defaultTo;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromLabel) || !/^\d{4}-\d{2}-\d{2}$/.test(toLabel)) {
    throw new ApiError(400, "INVALID_DATE_RANGE", "Даты должны быть в формате ГГГГ-ММ-ДД");
  }
  const from = new Date(`${fromLabel}T00:00:00+05:00`);
  const toStart = new Date(`${toLabel}T00:00:00+05:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(toStart.getTime()) || from > toStart) {
    throw new ApiError(400, "INVALID_DATE_RANGE", "Некорректный диапазон дат");
  }
  const toExclusive = new Date(toStart.getTime() + 24 * 60 * 60_000);
  if (toExclusive.getTime() - from.getTime() > 366 * 24 * 60 * 60_000) {
    throw new ApiError(400, "DATE_RANGE_TOO_LARGE", "Выгрузка доступна максимум за 366 дней");
  }
  return { from, toExclusive, label: `${fromLabel}_${toLabel}` };
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
