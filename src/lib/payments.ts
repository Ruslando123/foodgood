import { randomUUID } from "crypto";

export type ProviderPaymentStatus = "HELD" | "CAPTURED" | "REFUNDED" | "NOT_FOUND";
export type PaymentProviderErrorCode = "DECLINED" | "UNKNOWN" | "TIMEOUT";

export class PaymentProviderError extends Error {
  constructor(public readonly code: PaymentProviderErrorCode, message: string) {
    super(message);
  }
}

/** Все мутации обязаны быть идемпотентны по ключу: worker безопасно повторяет их. */
export interface PaymentProvider {
  name: string;
  hold(amountKzt: number, orderId: string, idempotencyKey: string): Promise<{ providerRef: string }>;
  capture(providerRef: string, idempotencyKey: string): Promise<void>;
  refund(providerRef: string, idempotencyKey: string): Promise<void>;
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  findHoldByIdempotencyKey(idempotencyKey: string): Promise<{ providerRef: string; status: ProviderPaymentStatus } | null>;
}

class MockPaymentProvider implements PaymentProvider {
  name = "mock";
  private readonly refsByKey = new Map<string, string>();
  private readonly statuses = new Map<string, ProviderPaymentStatus>();

  async hold(_amountKzt: number, orderId: string, idempotencyKey: string) {
    const existing = this.refsByKey.get(idempotencyKey);
    if (existing) return { providerRef: existing };
    const providerRef = `mock_${orderId}_${randomUUID().slice(0, 8)}`;
    this.refsByKey.set(idempotencyKey, providerRef);
    this.statuses.set(providerRef, "HELD");
    return { providerRef };
  }

  async capture(providerRef: string, idempotencyKey: string) {
    const key = `capture:${idempotencyKey}`;
    if (this.refsByKey.has(key)) return;
    this.refsByKey.set(key, providerRef);
    if (this.statuses.get(providerRef) === "HELD") this.statuses.set(providerRef, "CAPTURED");
  }

  async refund(providerRef: string, idempotencyKey: string) {
    const key = `refund:${idempotencyKey}`;
    if (this.refsByKey.has(key)) return;
    this.refsByKey.set(key, providerRef);
    if (this.statuses.get(providerRef) === "HELD") this.statuses.set(providerRef, "REFUNDED");
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    return this.statuses.get(providerRef) ?? "NOT_FOUND";
  }

  async findHoldByIdempotencyKey(idempotencyKey: string) {
    const providerRef = this.refsByKey.get(idempotencyKey);
    return providerRef ? { providerRef, status: await this.getStatus(providerRef) } : null;
  }
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();
