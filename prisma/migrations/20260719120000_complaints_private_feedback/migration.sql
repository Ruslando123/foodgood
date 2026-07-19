-- P0 complaints and private post-pickup feedback.
-- The legacy support snapshot is copied before any Order columns are removed.

CREATE TABLE "Complaint" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "note" TEXT NOT NULL DEFAULT '',
  "ownerId" TEXT,
  "firstContactAt" TIMESTAMP(3),
  "partnerResponse" TEXT NOT NULL DEFAULT '',
  "resolution" TEXT NOT NULL DEFAULT '',
  "customerConfirmed" BOOLEAN,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "escalatedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplaintEvent" (
  "id" TEXT NOT NULL,
  "complaintId" TEXT NOT NULL,
  "actorId" TEXT,
  "type" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "message" TEXT NOT NULL DEFAULT '',
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "visibleToCustomer" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplaintEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplaintAttachment" (
  "id" TEXT NOT NULL,
  "complaintId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplaintAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostPickupFeedback" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "quality" INTEGER NOT NULL,
  "freshness" INTEGER NOT NULL,
  "match" INTEGER NOT NULL,
  "value" INTEGER NOT NULL,
  "pickup" INTEGER NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostPickupFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComplaintAttachment_storageKey_key" ON "ComplaintAttachment"("storageKey");
CREATE UNIQUE INDEX "PostPickupFeedback_orderId_key" ON "PostPickupFeedback"("orderId");
CREATE INDEX "Complaint_customerId_createdAt_idx" ON "Complaint"("customerId", "createdAt" DESC);
CREATE INDEX "Complaint_status_openedAt_idx" ON "Complaint"("status", "openedAt");
CREATE INDEX "Complaint_ownerId_status_idx" ON "Complaint"("ownerId", "status");
CREATE INDEX "Complaint_orderId_createdAt_idx" ON "Complaint"("orderId", "createdAt" DESC);
CREATE INDEX "ComplaintEvent_complaintId_createdAt_idx" ON "ComplaintEvent"("complaintId", "createdAt");
CREATE INDEX "ComplaintEvent_actorId_createdAt_idx" ON "ComplaintEvent"("actorId", "createdAt");
CREATE INDEX "ComplaintAttachment_complaintId_createdAt_idx" ON "ComplaintAttachment"("complaintId", "createdAt");
CREATE INDEX "PostPickupFeedback_venueId_createdAt_idx" ON "PostPickupFeedback"("venueId", "createdAt");
CREATE INDEX "PostPickupFeedback_userId_createdAt_idx" ON "PostPickupFeedback"("userId", "createdAt");

ALTER TABLE "Complaint"
  ADD CONSTRAINT "Complaint_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Complaint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Complaint_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Complaint_status_check" CHECK ("status" IN ('OPEN', 'UNDER_REVIEW', 'WAITING_FOR_PARTNER', 'RESOLVED', 'ESCALATED', 'CLOSED')),
  ADD CONSTRAINT "Complaint_category_check" CHECK ("category" IN ('VENUE_CLOSED', 'ORDER_MISSING', 'POOR_QUALITY', 'WRONG_CONTENT', 'FOOD_SAFETY', 'OTHER')),
  ADD CONSTRAINT "Complaint_timestamps_check" CHECK (
    ("firstContactAt" IS NULL OR "firstContactAt" >= "openedAt")
    AND ("escalatedAt" IS NULL OR "escalatedAt" >= "openedAt")
    AND ("resolvedAt" IS NULL OR "resolvedAt" >= "openedAt")
    AND ("closedAt" IS NULL OR "closedAt" >= "openedAt")
  );

ALTER TABLE "ComplaintEvent"
  ADD CONSTRAINT "ComplaintEvent_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ComplaintEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComplaintAttachment"
  ADD CONSTRAINT "ComplaintAttachment_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ComplaintAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ComplaintAttachment_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880),
  ADD CONSTRAINT "ComplaintAttachment_type_check" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

ALTER TABLE "PostPickupFeedback"
  ADD CONSTRAINT "PostPickupFeedback_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PostPickupFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PostPickupFeedback_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PostPickupFeedback_scores_check" CHECK (
    "quality" BETWEEN 1 AND 5
    AND "freshness" BETWEEN 1 AND 5
    AND "match" BETWEEN 1 AND 5
    AND "value" BETWEEN 1 AND 5
    AND "pickup" BETWEEN 1 AND 5
  );

-- One legacy Order represented at most one mutable case, so it maps to one
-- complaint without deduplicating or overwriting any user-provided text.
INSERT INTO "Complaint" (
  "id", "orderId", "customerId", "category", "status", "note", "ownerId",
  "firstContactAt", "partnerResponse", "resolution", "customerConfirmed",
  "openedAt", "resolvedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-' || o."id",
  o."id",
  o."userId",
  COALESCE(o."supportCategory", 'OTHER'),
  CASE WHEN o."supportStatus" = 'RESOLVED' THEN 'RESOLVED' ELSE 'OPEN' END,
  o."supportNote",
  o."supportOwnerId",
  o."supportFirstContactAt",
  o."supportVenueResponse",
  o."supportResolution",
  o."supportCustomerConfirmed",
  COALESCE(o."supportOpenedAt", o."createdAt"),
  o."supportResolvedAt",
  COALESCE(o."supportOpenedAt", o."createdAt"),
  COALESCE(o."supportResolvedAt", o."supportFirstContactAt", o."supportOpenedAt", o."createdAt")
FROM "Order" o
WHERE o."supportStatus" IN ('OPEN', 'RESOLVED');

INSERT INTO "ComplaintEvent" (
  "id", "complaintId", "actorId", "type", "fromStatus", "toStatus",
  "message", "metadataJson", "visibleToCustomer", "createdAt"
)
SELECT
  'legacy-open-' || o."id",
  'legacy-' || o."id",
  NULL,
  'MIGRATED_OPENED',
  NULL,
  'OPEN',
  o."supportNote",
  json_build_object('source', 'Order.support*')::text,
  true,
  COALESCE(o."supportOpenedAt", o."createdAt")
FROM "Order" o
WHERE o."supportStatus" IN ('OPEN', 'RESOLVED');

INSERT INTO "ComplaintEvent" (
  "id", "complaintId", "actorId", "type", "fromStatus", "toStatus",
  "message", "metadataJson", "visibleToCustomer", "createdAt"
)
SELECT
  'legacy-resolved-' || o."id",
  'legacy-' || o."id",
  o."supportOwnerId",
  'MIGRATED_RESOLUTION',
  'OPEN',
  'RESOLVED',
  o."supportResolution",
  json_build_object(
    'source', 'Order.support*',
    'partnerResponse', o."supportVenueResponse",
    'customerConfirmed', o."supportCustomerConfirmed"
  )::text,
  true,
  o."supportResolvedAt"
FROM "Order" o
WHERE o."supportStatus" = 'RESOLVED' AND o."supportResolvedAt" IS NOT NULL;

DROP INDEX IF EXISTS "Order_supportStatus_supportOpenedAt_idx";
DROP INDEX IF EXISTS "Order_supportOwnerId_supportStatus_idx";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_support_status_check";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_support_category_check";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_support_timestamps_check";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_supportOwnerId_fkey";
ALTER TABLE "Order"
  DROP COLUMN "supportStatus",
  DROP COLUMN "supportCategory",
  DROP COLUMN "supportNote",
  DROP COLUMN "supportOpenedAt",
  DROP COLUMN "supportOwnerId",
  DROP COLUMN "supportFirstContactAt",
  DROP COLUMN "supportVenueResponse",
  DROP COLUMN "supportCustomerConfirmed",
  DROP COLUMN "supportResolvedAt",
  DROP COLUMN "supportResolution";
