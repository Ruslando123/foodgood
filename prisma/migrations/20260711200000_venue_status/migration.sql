ALTER TABLE "Venue" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX "Venue_status_idx" ON "Venue"("status");
