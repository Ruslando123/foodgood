import { NextResponse } from "next/server";
import { logEvent } from "@/lib/monitoring";
import { apiDuration } from "@/lib/metrics";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

const STATIC_API_SEGMENTS = new Set([
  "api", "admin", "business", "auth", "orders", "bags", "venues", "owners", "users",
  "reviews", "favorites", "notifications", "metrics", "health", "live", "ready", "deep", "internal",
  "redeem", "finance", "export", "stats", "phone", "verify", "logout", "logout-all", "me",
  "support", "cancel", "review", "media",
  "analytics", "events",
  "partners", "onboarding",
]);

function routeLabel(request?: Request): string {
  if (!request) return "unknown";
  return new URL(request.url).pathname
    .split("/")
    .map((segment) => !segment || STATIC_API_SEGMENTS.has(segment) ? segment : ":id")
    .join("/");
}

export async function apiRoute(
  requestOrHandler: Request | (() => Promise<NextResponse>),
  optionalHandler?: () => Promise<NextResponse>
): Promise<NextResponse<ApiErrorBody | unknown>> {
  const request = typeof requestOrHandler === "function" ? undefined : requestOrHandler;
  const handler = typeof requestOrHandler === "function" ? requestOrHandler : optionalHandler;
  if (!handler) throw new Error("API handler is required");
  const labels = { method: request?.method ?? "UNKNOWN", route: routeLabel(request) };
  const stop = apiDuration.startTimer();
  try {
    if (request && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      assertSameOrigin(request);
    }
    const response = await handler();
    stop({ ...labels, status: String(response.status) });
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      stop({ ...labels, status: String(error.status) });
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        { status: error.status }
      );
    }

    logEvent("error", "api.unhandled_error", {}, error);
    stop({ ...labels, status: "500" });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" } },
      { status: 500 }
    );
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  assertSameOrigin(request);
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Некорректный JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_BODY", "Тело запроса должно быть объектом");
  }
  return value as Record<string, unknown>;
}

/** Блокирует cookie-authenticated mutation из чужого origin. */
export function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new ApiError(403, "CROSS_SITE_REQUEST", "Запрос с другого сайта запрещён");
  }

  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin) {
    throw new ApiError(403, "INVALID_ORIGIN", "Источник запроса не разрешён");
  }
}
