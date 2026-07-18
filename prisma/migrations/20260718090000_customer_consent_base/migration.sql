ALTER TABLE "User"
  ADD COLUMN "privacyPolicyVersion" TEXT,
  ADD COLUMN "privacyAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "communicationsConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "communicationsConsentUpdatedAt" TIMESTAMP(3);

-- The export and notification fanout both need a cheap, auditable way to
-- select only customers with an active voluntary communications permission.
CREATE INDEX "User_role_communicationsConsent_idx"
  ON "User"("role", "communicationsConsent");
