ALTER TABLE "User"
  ADD COLUMN "termsVersion" TEXT,
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedAt" TIMESTAMP(3);

ALTER TABLE "Bag"
  ADD COLUMN "composition" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "storage" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "examplePhoto" TEXT NOT NULL DEFAULT '';

-- Existing accounts used the legacy combined legal notice.  We preserve the
-- historical privacy acceptance but deliberately do not invent a terms audit
-- event: customers must accept the current terms on their next login/settings
-- visit.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_status_check";
ALTER TABLE "User"
  ADD CONSTRAINT "User_status_check"
    CHECK (status IN ('ACTIVE', 'BLOCKED', 'DEACTIVATED')) NOT VALID;

CREATE TABLE "AccountDeletionRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "retentionReason" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountDeletionRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AccountDeletionRequest_status_check"
    CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED')) NOT VALID
);

CREATE INDEX "AccountDeletionRequest_userId_requestedAt_idx"
  ON "AccountDeletionRequest"("userId", "requestedAt" DESC);
CREATE INDEX "AccountDeletionRequest_status_requestedAt_idx"
  ON "AccountDeletionRequest"("status", "requestedAt");
CREATE UNIQUE INDEX "AccountDeletionRequest_one_pending_per_user_idx"
  ON "AccountDeletionRequest"("userId") WHERE status = 'PENDING';
