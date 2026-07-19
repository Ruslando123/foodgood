-- The new legal entity is nullable at the field level so existing merchant
-- rows can be backfilled without inventing IIN/BIN or representing them as
-- verified. Publication is fail-closed until an admin verifies the record.
CREATE TABLE "PartnerBusiness" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "legalType" TEXT,
  "legalName" TEXT,
  "businessIdentifier" TEXT,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "verificationNote" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PartnerBusiness_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerBusiness_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerBusiness_status_check" CHECK ("verificationStatus" IN ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED')),
  CONSTRAINT "PartnerBusiness_legal_type_check" CHECK ("legalType" IS NULL OR "legalType" IN ('IP', 'TOO')),
  CONSTRAINT "PartnerBusiness_identifier_check" CHECK ("businessIdentifier" IS NULL OR "businessIdentifier" ~ '^[0-9]{12}$')
);

CREATE UNIQUE INDEX "PartnerBusiness_ownerId_key" ON "PartnerBusiness"("ownerId");
CREATE UNIQUE INDEX "PartnerBusiness_businessIdentifier_key" ON "PartnerBusiness"("businessIdentifier");
CREATE INDEX "PartnerBusiness_verificationStatus_updatedAt_idx" ON "PartnerBusiness"("verificationStatus", "updatedAt");

CREATE TABLE "PartnerAgreementAcceptance" (
  "id" TEXT NOT NULL,
  "partnerBusinessId" TEXT NOT NULL,
  "agreementVersion" TEXT NOT NULL,
  "acceptedById" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PartnerAgreementAcceptance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerAgreementAcceptance_partnerBusinessId_fkey" FOREIGN KEY ("partnerBusinessId") REFERENCES "PartnerBusiness"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerAgreementAcceptance_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PartnerAgreementAcceptance_partnerBusinessId_agreementVersion_key"
  ON "PartnerAgreementAcceptance"("partnerBusinessId", "agreementVersion");
CREATE INDEX "PartnerAgreementAcceptance_acceptedById_acceptedAt_idx"
  ON "PartnerAgreementAcceptance"("acceptedById", "acceptedAt");

ALTER TABLE "Bag"
  ADD COLUMN "suitableForSaleAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "storageCompliantAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allergensCurrentAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "categoryAllowedAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "safetyAttestedAt" TIMESTAMP(3),
  ADD COLUMN "safetyAttestedById" TEXT;

-- Preserve every existing row while putting historical merchants into a
-- review queue. md5(owner id) is deterministic and collision-resistant enough
-- for this migration; the unique owner constraint is the real identity key.
INSERT INTO "PartnerBusiness" ("id", "ownerId", "verificationStatus", "createdAt", "updatedAt")
SELECT 'legacy_' || md5(users.id), users.id, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" users
WHERE users.role = 'MERCHANT'
ON CONFLICT ("ownerId") DO NOTHING;
