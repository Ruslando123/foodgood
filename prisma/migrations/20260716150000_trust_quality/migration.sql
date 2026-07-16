-- Trust and quality: disclose possible allergens and make complaints actionable.
ALTER TABLE "Bag"
ADD COLUMN "allergens" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Order"
ADD COLUMN "supportCategory" TEXT,
ADD COLUMN "supportOpenedAt" TIMESTAMP(3),
ADD COLUMN "supportResolvedAt" TIMESTAMP(3),
ADD COLUMN "supportResolution" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Order_supportStatus_supportOpenedAt_idx"
ON "Order"("supportStatus", "supportOpenedAt");
