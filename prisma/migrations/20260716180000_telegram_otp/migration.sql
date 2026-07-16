CREATE TABLE "TelegramLoginRequest" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "telegramId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLoginRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramLoginRequest_tokenHash_key" ON "TelegramLoginRequest"("tokenHash");
CREATE INDEX "TelegramLoginRequest_phone_status_createdAt_idx" ON "TelegramLoginRequest"("phone", "status", "createdAt" DESC);
CREATE INDEX "TelegramLoginRequest_telegramId_status_createdAt_idx" ON "TelegramLoginRequest"("telegramId", "status", "createdAt" DESC);
CREATE INDEX "TelegramLoginRequest_expiresAt_idx" ON "TelegramLoginRequest"("expiresAt");
