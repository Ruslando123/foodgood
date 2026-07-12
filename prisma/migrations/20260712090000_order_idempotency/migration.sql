CREATE TABLE "OrderIdempotencyKey" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "resultJson" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderIdempotencyKey_key_key" ON "OrderIdempotencyKey"("key");
CREATE INDEX "OrderIdempotencyKey_expiresAt_idx" ON "OrderIdempotencyKey"("expiresAt");
CREATE INDEX "OrderIdempotencyKey_status_expiresAt_idx" ON "OrderIdempotencyKey"("status", "expiresAt");
