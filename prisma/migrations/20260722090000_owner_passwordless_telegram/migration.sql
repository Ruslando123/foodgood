ALTER TABLE "TelegramLoginRequest"
  ADD COLUMN "pollTokenHash" TEXT;

CREATE UNIQUE INDEX "TelegramLoginRequest_pollTokenHash_key"
  ON "TelegramLoginRequest"("pollTokenHash");

ALTER TABLE "TelegramLoginRequest"
  DROP CONSTRAINT "TelegramLoginRequest_status_check",
  ADD CONSTRAINT "TelegramLoginRequest_status_check"
    CHECK (status IN ('PENDING', 'WAITING_CONTACT', 'VERIFIED', 'CODE_SENT', 'CONSUMED')) NOT VALID;

ALTER TABLE "TelegramLoginRequest"
  VALIDATE CONSTRAINT "TelegramLoginRequest_status_check";
