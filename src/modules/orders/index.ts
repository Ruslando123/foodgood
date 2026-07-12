// Публичная граница домена заказов. Реализация пока остаётся совместимой
// со старыми импортами, а новые модули зависят только от этого entry point.
export * from "@/lib/orders";

import { OrderError } from "@/lib/orders";
import { PaymentConfigurationError } from "@/lib/payments";
import { ApiError } from "@/shared/server/api";

export function throwOrderApiError(error: unknown): never {
  if (error instanceof OrderError) {
    throw new ApiError(409, "ORDER_CONFLICT", error.message);
  }
  if (error instanceof PaymentConfigurationError) {
    throw new ApiError(503, "PAYMENTS_NOT_CONFIGURED", "Оплата временно недоступна");
  }
  throw error;
}
