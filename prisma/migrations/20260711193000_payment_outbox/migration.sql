ALTER TABLE "PaymentEvent" ADD COLUMN "operationId" TEXT;
CREATE UNIQUE INDEX "PaymentEvent_operationId_key" ON "PaymentEvent"("operationId");
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "PaymentOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OutboxMessage" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "orderId" TEXT,
  "type" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutboxMessage_operationId_type_key" ON "OutboxMessage"("operationId", "type");
CREATE INDEX "OutboxMessage_status_nextAttemptAt_idx" ON "OutboxMessage"("status", "nextAttemptAt");
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "PaymentOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
