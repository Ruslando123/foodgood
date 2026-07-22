-- P0 lifecycle for free PAY_AT_VENUE reservations. There are deliberately no
-- payment, webhook, capture or refund entities in this migration.

ALTER TABLE "Order"
  DROP CONSTRAINT IF EXISTS "Order_status_check",
  DROP CONSTRAINT IF EXISTS "Order_completion_check";

-- Legacy rows did not retain the cancelling actor. A cancelled bag is the one
-- reliable signal of a partner cancellation; all other legacy cancellations
-- are classified as customer cancellations and marked as inferred in history.
UPDATE "Order" orders
SET status = CASE
  WHEN orders.status = 'CANCELLED' AND bag.status = 'CANCELLED' THEN 'CANCELLED_BY_PARTNER'
  WHEN orders.status = 'CANCELLED' THEN 'CANCELLED_BY_USER'
  WHEN orders.status = 'EXPIRED' THEN 'NO_SHOW'
  ELSE orders.status
END
FROM "Bag" bag
WHERE bag.id = orders."bagId"
  AND orders.status IN ('CANCELLED', 'EXPIRED');

CREATE TABLE "OrderStatusHistory" (
  id TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  status TEXT NOT NULL,
  actor TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  reason TEXT NOT NULL,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY (id),
  CONSTRAINT "OrderStatusHistory_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PickupJournal" (
  id TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  actor TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "pickupCodeSuffix" TEXT NOT NULL,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PickupJournal_pkey" PRIMARY KEY (id),
  CONSTRAINT "PickupJournal_orderId_key" UNIQUE ("orderId"),
  CONSTRAINT "PickupJournal_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OrderStatusHistory_orderId_timestamp_idx"
  ON "OrderStatusHistory"("orderId", timestamp);
CREATE INDEX "OrderStatusHistory_status_timestamp_idx"
  ON "OrderStatusHistory"(status, timestamp);
CREATE INDEX "PickupJournal_timestamp_idx" ON "PickupJournal"(timestamp);

INSERT INTO "OrderStatusHistory" (
  id, "orderId", status, actor, "actorRole", reason, "metadataJson", timestamp
)
SELECT
  'backfill-' || orders.id,
  orders.id,
  orders.status,
  'SYSTEM',
  'SYSTEM',
  'LEGACY_BACKFILL',
  jsonb_build_object('inferred', true)::text,
  COALESCE(orders."completedAt", orders."createdAt")
FROM "Order" orders;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_status_check"
    CHECK (status IN (
      'RESERVED', 'READY_FOR_PICKUP', 'COMPLETED',
      'CANCELLED_BY_USER', 'CANCELLED_BY_PARTNER', 'NO_SHOW', 'DISPUTED'
    )),
  ADD CONSTRAINT "Order_completion_check"
    CHECK (
      (status <> 'COMPLETED' OR "completedAt" IS NOT NULL)
      AND ("completedAt" IS NULL OR "completedAt" >= "createdAt")
    );

ALTER TABLE "OrderStatusHistory"
  ADD CONSTRAINT "OrderStatusHistory_status_check"
    CHECK (status IN (
      'RESERVED', 'READY_FOR_PICKUP', 'COMPLETED',
      'CANCELLED_BY_USER', 'CANCELLED_BY_PARTNER', 'NO_SHOW', 'DISPUTED'
    )),
  ADD CONSTRAINT "OrderStatusHistory_actorRole_check"
    CHECK ("actorRole" IN ('CUSTOMER', 'PARTNER', 'ADMIN', 'SYSTEM'));

ALTER TABLE "PickupJournal"
  ADD CONSTRAINT "PickupJournal_actorRole_check"
    CHECK ("actorRole" IN ('PARTNER', 'ADMIN', 'SYSTEM'));

-- Operational journals are append-only even for direct SQL users.
CREATE FUNCTION prevent_order_journal_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderStatusHistory_append_only"
  BEFORE UPDATE OR DELETE ON "OrderStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION prevent_order_journal_mutation();

CREATE TRIGGER "PickupJournal_append_only"
  BEFORE UPDATE OR DELETE ON "PickupJournal"
  FOR EACH ROW EXECUTE FUNCTION prevent_order_journal_mutation();
