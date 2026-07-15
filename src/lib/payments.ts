import { randomUUID } from "crypto";
import { applyMockPaymentFault } from "./mock-payment-fault";
import {
  FreedomPayConfig,
  FreedomPayFields,
  FreedomPayProtocolError,
  freedomPayRequest,
  getFreedomPayConfig,
} from "./freedompay";

export type ProviderPaymentStatus = "PENDING" | "HELD" | "CAPTURED" | "REFUNDED" | "FAILED" | "NOT_FOUND";
export type PaymentProviderErrorCode = "DECLINED" | "UNKNOWN" | "TIMEOUT";

export class PaymentProviderError extends Error {
  constructor(public readonly code: PaymentProviderErrorCode, message: string) {
    super(message);
  }
}

export class PaymentConfigurationError extends Error {}

/** Все мутации обязаны быть идемпотентны по ключу: worker безопасно повторяет их. */
export interface PaymentProvider {
  name: string;
  hold(amountKzt: number, orderId: string, idempotencyKey: string): Promise<{ providerRef: string; status: ProviderPaymentStatus }>;
  capture(providerRef: string, idempotencyKey: string): Promise<void>;
  refund(providerRef: string, idempotencyKey: string): Promise<void>;
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  findHoldByIdempotencyKey(idempotencyKey: string): Promise<{ providerRef: string; status: ProviderPaymentStatus } | null>;
}

export class MockPaymentProvider implements PaymentProvider {
  name = "mock";
  private readonly refsByKey = new Map<string, string>();
  private readonly statuses = new Map<string, ProviderPaymentStatus>();

  async hold(_amountKzt: number, orderId: string, idempotencyKey: string) {
    await applyMockPaymentFault();
    const existing = this.refsByKey.get(idempotencyKey);
    if (existing) return { providerRef: existing, status: await this.getStatus(existing) };
    const providerRef = `mock_${orderId}_${randomUUID().slice(0, 8)}`;
    this.refsByKey.set(idempotencyKey, providerRef);
    this.statuses.set(providerRef, "HELD");
    return { providerRef, status: "HELD" as const };
  }

  async capture(providerRef: string, idempotencyKey: string) {
    await applyMockPaymentFault();
    const key = `capture:${idempotencyKey}`;
    if (this.refsByKey.has(key)) return;
    this.refsByKey.set(key, providerRef);
    const status = this.statuses.get(providerRef);
    if (status === undefined || status === "HELD") this.statuses.set(providerRef, "CAPTURED");
  }

  async refund(providerRef: string, idempotencyKey: string) {
    await applyMockPaymentFault();
    const key = `refund:${idempotencyKey}`;
    if (this.refsByKey.has(key)) return;
    this.refsByKey.set(key, providerRef);
    const status = this.statuses.get(providerRef);
    if (status === undefined || status === "HELD" || status === "CAPTURED") this.statuses.set(providerRef, "REFUNDED");
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    await applyMockPaymentFault();
    return this.statuses.get(providerRef) ?? (providerRef.startsWith("mock_") ? "HELD" : "NOT_FOUND");
  }

  async findHoldByIdempotencyKey(idempotencyKey: string) {
    const providerRef = this.refsByKey.get(idempotencyKey);
    return providerRef ? { providerRef, status: await this.getStatus(providerRef) } : null;
  }
}

function providerStatus(fields: FreedomPayFields, expectedAmount?: number): ProviderPaymentStatus {
  const status = (fields.pg_payment_status ?? fields.pg_transaction_status ?? fields.pg_status ?? "").toLowerCase();
  if (["revoked", "reversed", "cancelled", "canceled", "refunded"].includes(status)) return "REFUNDED";
  if (["error", "failed", "failure", "declined", "incomplete"].includes(status)) return "FAILED";
  if (["partial", "pending", "process", "processing", "new"].includes(status)) return "PENDING";
  const refundAmount = Math.max(
    Math.abs(Number(fields.pg_revoke_amount ?? 0)),
    Math.abs(Number(fields.pg_refund_amount ?? 0))
  );
  if (expectedAmount !== undefined && Number.isFinite(refundAmount) && refundAmount >= expectedAmount) return "REFUNDED";
  if (fields.pg_captured === "1" || fields.pg_captured === "true") return "CAPTURED";
  if (["ok", "success", "successful"].includes(status) || fields.pg_result === "1") return "HELD";
  return "PENDING";
}

export class FreedomPayProvider implements PaymentProvider {
  name = "freedompay";

  constructor(
    private readonly config: FreedomPayConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async request(scriptName: string, fields: FreedomPayFields): Promise<FreedomPayFields> {
    try {
      const result = await freedomPayRequest(this.config, scriptName, fields, this.fetcher);
      if ((result.pg_status ?? "").toLowerCase() === "error") {
        const description = `${result.pg_error_code ? `${result.pg_error_code}: ` : ""}${result.pg_error_description ?? "Freedom Pay rejected request"}`;
        const declined = /declin|insufficient|отказ|недостат/i.test(description);
        throw new PaymentProviderError(declined ? "DECLINED" : "UNKNOWN", description);
      }
      return result;
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      if (error instanceof FreedomPayProtocolError) throw new PaymentProviderError("UNKNOWN", error.message);
      throw error;
    }
  }

  async hold(amountKzt: number, orderId: string, idempotencyKey: string) {
    const result = await this.request("init_payment.php", {
      pg_order_id: idempotencyKey,
      pg_amount: String(amountKzt),
      pg_currency: "KZT",
      pg_description: `FoodGood order ${orderId}`,
      pg_result_url: `${this.config.appBaseUrl}/api/payments/freedompay/result`,
      pg_request_method: "POST",
      pg_success_url: `${this.config.appBaseUrl}/orders?payment=success&order=${encodeURIComponent(orderId)}`,
      pg_success_url_method: "GET",
      pg_failure_url: `${this.config.appBaseUrl}/orders?payment=failed&order=${encodeURIComponent(orderId)}`,
      pg_failure_url_method: "GET",
      pg_language: "ru",
      pg_auto_clearing: "0",
      pg_payment_method: "bankcard",
      pg_user_id: orderId,
      ...(this.config.testingMode ? { pg_testing_mode: "1" } : {}),
    });
    const providerRef = result.pg_payment_id;
    if (!providerRef) throw new PaymentProviderError("UNKNOWN", "Freedom Pay did not return pg_payment_id");
    return { providerRef, status: "PENDING" as const };
  }

  async capture(providerRef: string): Promise<void> {
    await this.request("do_capture.php", { pg_payment_id: providerRef });
  }

  async refund(providerRef: string): Promise<void> {
    const status = await this.getStatus(providerRef);
    if (status === "REFUNDED") return;
    if (status !== "HELD" && status !== "CAPTURED") {
      throw new PaymentProviderError("UNKNOWN", `Cannot refund payment in ${status} status`);
    }
    try {
      await this.request(status === "HELD" ? "cancel" : "revoke", { pg_payment_id: providerRef });
    } catch (error) {
      if (error instanceof PaymentProviderError && /\b4004\b/.test(error.message)) return;
      throw error;
    }
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    const result = await this.request("get_status3.php", { pg_payment_id: providerRef });
    return providerStatus(result, Number(result.pg_amount));
  }

  async findHoldByIdempotencyKey(idempotencyKey: string) {
    try {
      const result = await this.request("get_status2.php", { pg_order_id: idempotencyKey });
      const providerRef = result.pg_payment_id;
      if (!providerRef) return null;
      return { providerRef, status: providerStatus(result, Number(result.pg_amount)) };
    } catch (error) {
      if (error instanceof PaymentProviderError && /\b(?:340|4002)\b|not found|не найден/i.test(error.message)) return null;
      throw error;
    }
  }
}

function createPaymentProvider(): PaymentProvider {
  const config = getFreedomPayConfig();
  return config ? new FreedomPayProvider(config) : new MockPaymentProvider();
}

export const paymentProvider: PaymentProvider = createPaymentProvider();

export function assertPaymentProviderReady(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION === "true") {
    throw new PaymentConfigurationError("ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true is forbidden");
  }
  const localProductionE2e =
    process.env.FOODGOOD_E2E_DEV_OTP === "true" &&
    /(?:localhost|127\.0\.0\.1):\d+/.test(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV === "production" && paymentProvider.name === "mock" && !localProductionE2e) {
    throw new PaymentConfigurationError("A real payment provider must be configured in production");
  }
}
