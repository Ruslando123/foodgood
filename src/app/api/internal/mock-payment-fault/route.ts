import { NextRequest } from "next/server";
import { paymentProvider } from "@/lib/payments";
import { getMockPaymentFault, getMockPaymentFaultStats, setMockPaymentFault } from "@/lib/mock-payment-fault";
import { PAYMENT_PROVIDER_TIMEOUT_MS, MOCK_PROVIDER_TIMEOUT_DELAY_MS } from "@/lib/payment-config";
import { apiRoute, ApiError, json, readJsonObject } from "@/shared/server/api";

function authorize(request: NextRequest): void {
  const enabled = process.env.LOAD_TEST_MODE === "true";
  const secret = process.env.LOAD_TEST_CONTROL_SECRET;
  if (!enabled || !secret || request.headers.get("authorization") !== `Bearer ${secret}` || paymentProvider.name !== "mock") {
    throw new ApiError(404, "NOT_FOUND", "Ресурс не найден");
  }
}

function runIdValue(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(value)) {
    throw new ApiError(400, "INVALID_RUN_ID", "Некорректный runId");
  }
  return value;
}

export async function POST(request: NextRequest) {
  return apiRoute(request, async () => {
    authorize(request);
    const body = await readJsonObject(request);
    const runId = runIdValue(body.runId);
    const delayMs = Number(body.delayMs ?? 0);
    const errorRate = Number(body.errorRate ?? 0);
    const timeoutRate = Number(body.timeoutRate ?? 0);
    const timeoutDelayMs = Number(body.timeoutDelayMs ?? MOCK_PROVIDER_TIMEOUT_DELAY_MS);
    const enabledSeconds = Number(body.enabledSeconds ?? 60);
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 30_000 ||
        !Number.isFinite(errorRate) || errorRate < 0 || errorRate > 1 ||
        !Number.isFinite(timeoutRate) || timeoutRate < 0 || timeoutRate > 1 ||
        errorRate + timeoutRate > 1 ||
        !Number.isFinite(enabledSeconds) || enabledSeconds < 1 || enabledSeconds > 3600) {
      throw new ApiError(400, "INVALID_FAULT_CONFIG", "Некорректная конфигурация fault mode");
    }
    if (!Number.isFinite(timeoutDelayMs) || timeoutDelayMs <= PAYMENT_PROVIDER_TIMEOUT_MS || timeoutDelayMs > 30_000) {
      throw new ApiError(400, "INVALID_TIMEOUT_DELAY", "timeoutDelayMs должен быть больше provider timeout");
    }
    const configuration = {
      runId,
      delayMs,
      errorRate,
      timeoutRate,
      timeoutDelayMs,
      enabledUntil: new Date(Date.now() + enabledSeconds * 1000).toISOString(),
    };
    await setMockPaymentFault(configuration);
    return json({ enabled: true, ...configuration });
  });
}

export async function GET(request: NextRequest) {
  return apiRoute(request, async () => {
    authorize(request);
    const runId = runIdValue(request.nextUrl.searchParams.get("runId"));
    const [configuration, statistics] = await Promise.all([
      getMockPaymentFault(),
      getMockPaymentFaultStats(runId),
    ]);
    return json({
      runId,
      configured: configuration?.runId === runId,
      applied: (statistics?.appliedCount ?? 0) > 0,
      statistics,
    });
  });
}

export async function DELETE(request: NextRequest) {
  return apiRoute(request, async () => {
    authorize(request);
    await setMockPaymentFault(null);
    return json({ enabled: false });
  });
}
