CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Venue"
  ADD COLUMN "location" geography(Point,4326),
  ADD COLUMN "ratingSum" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "Venue"
SET "location" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography;

UPDATE "Venue" venue
SET
  "ratingSum" = aggregate.sum,
  "ratingCount" = aggregate.count,
  "ratingAverage" = aggregate.sum::double precision / aggregate.count
FROM (
  SELECT "venueId", SUM(rating)::integer AS sum, COUNT(*)::integer AS count
  FROM "Review"
  WHERE "moderationStatus" = 'PUBLISHED'
  GROUP BY "venueId"
) aggregate
WHERE venue.id = aggregate."venueId";

CREATE INDEX "Venue_ownerId_idx" ON "Venue"("ownerId");
CREATE INDEX "Venue_location_gist_idx" ON "Venue" USING GIST ("location");
CREATE INDEX "Venue_catalog_search_trgm_idx" ON "Venue" USING GIN ((lower(name || ' ' || address)) gin_trgm_ops);
CREATE INDEX "Bag_title_search_trgm_idx" ON "Bag" USING GIN (lower(title) gin_trgm_ops);
CREATE INDEX "Bag_venueId_createdAt_idx" ON "Bag"("venueId", "createdAt" DESC);
CREATE INDEX "Bag_active_pickupEnd_id_idx" ON "Bag"("pickupEnd", id) WHERE status IN ('ACTIVE', 'SOLD_OUT');
CREATE INDEX "Favorite_venueId_userId_idx" ON "Favorite"("venueId", "userId");
CREATE INDEX "Order_userId_status_createdAt_id_idx" ON "Order"("userId", status, "createdAt" DESC, id DESC);
CREATE INDEX "PaymentOperation_active_queue_idx" ON "PaymentOperation"("nextAttemptAt", id) WHERE status IN ('PENDING', 'RETRY', 'PROCESSING');
CREATE INDEX "OutboxMessage_active_queue_idx" ON "OutboxMessage"("nextAttemptAt", id) WHERE status IN ('PENDING', 'RETRY', 'PROCESSING');

CREATE TABLE "BatchJob" (
  id TEXT NOT NULL,
  queue TEXT NOT NULL,
  type TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "dedupeKey" TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BatchJob_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX "BatchJob_dedupeKey_key" ON "BatchJob"("dedupeKey");
CREATE INDEX "BatchJob_queue_status_nextAttemptAt_idx" ON "BatchJob"(queue, status, "nextAttemptAt");
CREATE INDEX "BatchJob_leaseExpiresAt_idx" ON "BatchJob"("leaseExpiresAt");
CREATE INDEX "BatchJob_active_queue_idx" ON "BatchJob"(queue, "nextAttemptAt", id) WHERE status IN ('PENDING', 'RETRY', 'PROCESSING');

CREATE FUNCTION foodgood_sync_venue_location() RETURNS trigger AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Venue_sync_location"
BEFORE INSERT OR UPDATE OF lat, lng ON "Venue"
FOR EACH ROW EXECUTE FUNCTION foodgood_sync_venue_location();
