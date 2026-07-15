DROP INDEX IF EXISTS "PaymentOperation_active_queue_idx";
CREATE INDEX "PaymentOperation_active_queue_idx"
  ON "PaymentOperation"("nextAttemptAt", id)
  WHERE status IN ('PENDING', 'RETRY', 'PROCESSING', 'WAITING_PROVIDER');
