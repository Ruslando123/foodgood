-- Remove the online-payment subsystem while preserving reservation/order data.
-- Child tables are dropped first so this migration does not need CASCADE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Order"
    WHERE "paymentMethod" = 'ONLINE'
      AND status IN (
        'RESERVED',
        'PENDING_PAYMENT',
        'PAID',
        'READY_FOR_PICKUP',
        'CAPTURE_PENDING',
        'REFUND_PENDING'
      )
  ) THEN
    RAISE EXCEPTION 'Cannot remove payments while active legacy online orders exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Payment"
    WHERE status NOT IN ('REFUNDED', 'FAILED')
  ) THEN
    RAISE EXCEPTION 'Cannot remove payments while unsettled or captured payment records exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "PaymentOperation"
    WHERE status <> 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'Cannot remove payments while nonterminal payment operations exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "OutboxMessage"
    WHERE status NOT IN ('SENT', 'FAILED', 'SKIPPED')
  ) THEN
    RAISE EXCEPTION 'Cannot remove payments while nonterminal outbox messages exist';
  END IF;
END $$;

DROP TABLE IF EXISTS "OutboxMessage";
DROP TABLE IF EXISTS "PaymentEvent";
DROP TABLE IF EXISTS "PaymentOperation";
DROP TABLE IF EXISTS "Payment";

ALTER TABLE IF EXISTS "Order"
  ALTER COLUMN "status" SET DEFAULT 'RESERVED',
  DROP COLUMN IF EXISTS "platformFee",
  DROP COLUMN IF EXISTS "paymentMethod",
  DROP COLUMN IF EXISTS "refundTargetStatus";

ALTER TABLE IF EXISTS "ProductEvent"
  DROP COLUMN IF EXISTS "platformFee";
