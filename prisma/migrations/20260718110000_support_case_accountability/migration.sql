ALTER TABLE "Order"
  ADD COLUMN "supportOwnerId" TEXT,
  ADD COLUMN "supportFirstContactAt" TIMESTAMP(3),
  ADD COLUMN "supportVenueResponse" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "supportCustomerConfirmed" BOOLEAN;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_supportOwnerId_fkey"
  FOREIGN KEY ("supportOwnerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_supportOwnerId_supportStatus_idx"
  ON "Order"("supportOwnerId", "supportStatus");
