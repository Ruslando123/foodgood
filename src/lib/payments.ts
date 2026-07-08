import { randomUUID } from "crypto";

/**
 * Абстракция платёжного шлюза: холдирование при покупке, списание при
 * выдаче заказа, возврат при отмене. Для продакшена сюда добавляется
 * реализация под Kaspi Pay / CloudPayments / Freedom Pay — логика заказов
 * не меняется.
 */
export interface PaymentProvider {
  name: string;
  hold(amountKzt: number, orderId: string): Promise<{ providerRef: string }>;
  capture(providerRef: string): Promise<void>;
  refund(providerRef: string): Promise<void>;
}

class MockPaymentProvider implements PaymentProvider {
  name = "mock";

  async hold(amountKzt: number, orderId: string) {
    void amountKzt;
    return { providerRef: `mock_${orderId}_${randomUUID().slice(0, 8)}` };
  }

  async capture() {}

  async refund() {}
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();
