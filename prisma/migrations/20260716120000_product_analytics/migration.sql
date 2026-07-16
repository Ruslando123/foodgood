ALTER TABLE "Order"
  ADD COLUMN "clientSource" TEXT NOT NULL DEFAULT 'direct';

CREATE TABLE "ProductEvent" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "userId" TEXT,
  "anonymousId" TEXT,
  "venueId" TEXT NOT NULL,
  "bagId" TEXT NOT NULL,
  "orderId" TEXT,
  "amount" INTEGER NOT NULL,
  "platformFee" INTEGER NOT NULL DEFAULT 0,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "clientSource" TEXT NOT NULL DEFAULT 'direct',
  "dedupeKey" TEXT,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductEvent_dedupeKey_key" ON "ProductEvent"("dedupeKey");
CREATE INDEX "ProductEvent_name_createdAt_idx" ON "ProductEvent"("name", "createdAt");
CREATE INDEX "ProductEvent_venueId_createdAt_idx" ON "ProductEvent"("venueId", "createdAt");
CREATE INDEX "ProductEvent_bagId_createdAt_idx" ON "ProductEvent"("bagId", "createdAt");
CREATE INDEX "ProductEvent_orderId_createdAt_idx" ON "ProductEvent"("orderId", "createdAt");
CREATE INDEX "ProductEvent_userId_createdAt_idx" ON "ProductEvent"("userId", "createdAt");
