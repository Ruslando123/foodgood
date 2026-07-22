-- Align the migration-created column with Prisma's @updatedAt semantics.
-- Prisma supplies updatedAt on writes, so the database default is unnecessary
-- and would otherwise leave a persistent schema drift.
ALTER TABLE "PartnerBusiness"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
