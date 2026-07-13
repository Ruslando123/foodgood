ALTER TABLE "OrderIdempotencyKey"
  ADD COLUMN "ownerToken" TEXT;

ALTER TABLE "Order"
  ADD COLUMN "idempotencyRecordId" TEXT;

CREATE UNIQUE INDEX "Order_idempotencyRecordId_key"
  ON "Order"("idempotencyRecordId");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_idempotencyRecordId_fkey"
  FOREIGN KEY ("idempotencyRecordId") REFERENCES "OrderIdempotencyKey"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
