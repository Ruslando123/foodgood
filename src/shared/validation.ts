import { ApiError } from "@/shared/server/api";

type StringOptions = { min?: number; max?: number; trim?: boolean };

export function requiredString(
  value: unknown,
  field: string,
  options: StringOptions = {}
): string {
  const normalized = typeof value === "string" && options.trim !== false ? value.trim() : value;
  const min = options.min ?? 1;
  const max = options.max ?? 200;
  if (typeof normalized !== "string" || normalized.length < min || normalized.length > max) {
    throw new ApiError(400, "VALIDATION_ERROR", `Некорректное поле «${field}»`, {
      field,
      min,
      max,
    });
  }
  return normalized;
}

export function optionalString(value: unknown, field: string, max = 1000): string {
  if (value === undefined || value === null || value === "") return "";
  return requiredString(value, field, { min: 0, max });
}

export function integer(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {}
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, "VALIDATION_ERROR", `Некорректное поле «${field}»`, {
      field,
      min,
      max,
    });
  }
  return parsed;
}

export function finiteNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {}
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  const min = options.min ?? -Number.MAX_VALUE;
  const max = options.max ?? Number.MAX_VALUE;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, "VALIDATION_ERROR", `Некорректное поле «${field}»`, {
      field,
      min,
      max,
    });
  }
  return parsed;
}

export function dateValue(value: unknown, field: string): Date {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new ApiError(400, "VALIDATION_ERROR", `Некорректное поле «${field}»`, { field });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", `Некорректное поле «${field}»`, { field });
  }
  return date;
}
