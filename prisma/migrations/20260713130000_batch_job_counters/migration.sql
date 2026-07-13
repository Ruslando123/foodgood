-- Forward-only upgrade for databases that already applied the original
-- BatchJob migration. The conditional form also repairs an early staging
-- build that briefly created the new columns in the previous migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'BatchJob' AND column_name = 'attempts'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'BatchJob' AND column_name = 'batchesProcessed'
  ) THEN
    ALTER TABLE "BatchJob" RENAME COLUMN attempts TO "batchesProcessed";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'BatchJob' AND column_name = 'batchesProcessed'
  ) THEN
    ALTER TABLE "BatchJob" ADD COLUMN "batchesProcessed" INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'BatchJob' AND column_name = 'failureAttempts'
  ) THEN
    ALTER TABLE "BatchJob" ADD COLUMN "failureAttempts" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
