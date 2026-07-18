-- Database-level invariants for operational data.  Adding CHECK constraints
-- as NOT VALID keeps the initial lock short while still rejecting new bad
-- rows.  A following migration validates existing data using PostgreSQL's
-- lighter validation lock. No migration in this pair repairs production data.

ALTER TABLE "User"
  ADD CONSTRAINT "User_role_check"
    CHECK (role IN ('CUSTOMER', 'MERCHANT', 'ADMIN')) NOT VALID,
  ADD CONSTRAINT "User_status_check"
    CHECK (status IN ('ACTIVE', 'BLOCKED')) NOT VALID,
  ADD CONSTRAINT "User_sessionVersion_check"
    CHECK ("sessionVersion" >= 0) NOT VALID;

ALTER TABLE "OtpChallenge"
  ADD CONSTRAINT "OtpChallenge_attempts_check"
    CHECK (attempts >= 0 AND "maxAttempts" > 0 AND attempts <= "maxAttempts") NOT VALID,
  ADD CONSTRAINT "OtpChallenge_expiry_check"
    CHECK ("expiresAt" > "createdAt") NOT VALID;

ALTER TABLE "TelegramLoginRequest"
  ADD CONSTRAINT "TelegramLoginRequest_status_check"
    CHECK (status IN ('PENDING', 'WAITING_CONTACT', 'CODE_SENT', 'CONSUMED')) NOT VALID,
  ADD CONSTRAINT "TelegramLoginRequest_consumed_check"
    CHECK ((status = 'CONSUMED') = ("consumedAt" IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT "TelegramLoginRequest_expiry_check"
    CHECK ("expiresAt" > "createdAt") NOT VALID;

ALTER TABLE "RateLimitBucket"
  ADD CONSTRAINT "RateLimitBucket_count_check"
    CHECK (count >= 0) NOT VALID;

ALTER TABLE "Venue"
  ADD CONSTRAINT "Venue_status_check"
    CHECK (status IN ('ACTIVE', 'SUSPENDED')) NOT VALID,
  ADD CONSTRAINT "Venue_coordinates_check"
    CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180) NOT VALID,
  ADD CONSTRAINT "Venue_rating_aggregate_check"
    CHECK (
      "ratingCount" >= 0
      AND "ratingSum" >= 0
      AND "ratingSum"::bigint BETWEEN "ratingCount"::bigint AND (5 * "ratingCount"::bigint)
      AND "ratingAverage" BETWEEN 0 AND 5
      AND (
        ("ratingCount" = 0 AND "ratingSum" = 0 AND "ratingAverage" = 0)
        OR
        ("ratingCount" > 0 AND "ratingAverage" BETWEEN 1 AND 5)
      )
    ) NOT VALID;

ALTER TABLE "Bag"
  ADD CONSTRAINT "Bag_price_check"
    CHECK (price > 0 AND "originalPrice" >= price) NOT VALID,
  ADD CONSTRAINT "Bag_quantity_check"
    CHECK (
      "quantityTotal" > 0
      AND "quantityLeft" BETWEEN 0 AND "quantityTotal"
    ) NOT VALID,
  ADD CONSTRAINT "Bag_pickup_window_check"
    CHECK ("pickupStart" < "pickupEnd") NOT VALID,
  ADD CONSTRAINT "Bag_status_check"
    CHECK (status IN ('ACTIVE', 'SOLD_OUT', 'EXPIRED', 'CANCELLED')) NOT VALID;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_quantity_check"
    CHECK (quantity > 0) NOT VALID,
  ADD CONSTRAINT "Order_totalPrice_check"
    CHECK ("totalPrice" > 0) NOT VALID,
  ADD CONSTRAINT "Order_status_check"
    CHECK (status IN ('RESERVED', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'EXPIRED')) NOT VALID,
  ADD CONSTRAINT "Order_completion_check"
    CHECK (
      (status = 'COMPLETED') = ("completedAt" IS NOT NULL)
      AND ("completedAt" IS NULL OR "completedAt" >= "createdAt")
    ) NOT VALID,
  ADD CONSTRAINT "Order_support_status_check"
    CHECK ("supportStatus" IN ('NONE', 'OPEN', 'RESOLVED')) NOT VALID,
  ADD CONSTRAINT "Order_support_category_check"
    CHECK (
      "supportCategory" IS NULL
      OR "supportCategory" IN ('VENUE_CLOSED', 'ORDER_MISSING', 'POOR_QUALITY', 'WRONG_CONTENT', 'OTHER')
    ) NOT VALID,
  ADD CONSTRAINT "Order_support_timestamps_check"
    CHECK (
      "supportResolvedAt" IS NULL
      OR (
        "supportOpenedAt" IS NOT NULL
        AND "supportResolvedAt" >= "supportOpenedAt"
      )
    ) NOT VALID;

ALTER TABLE "ProductEvent"
  ADD CONSTRAINT "ProductEvent_amount_check"
    CHECK (amount >= 0) NOT VALID,
  ADD CONSTRAINT "ProductEvent_quantity_check"
    CHECK (quantity > 0) NOT VALID;

ALTER TABLE "OrderIdempotencyKey"
  ADD CONSTRAINT "OrderIdempotencyKey_status_check"
    CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')) NOT VALID,
  ADD CONSTRAINT "OrderIdempotencyKey_expiry_check"
    CHECK ("expiresAt" > "createdAt") NOT VALID;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_channel_check"
    CHECK (channel IN ('IN_APP', 'SMS', 'TELEGRAM', 'PUSH', 'EMAIL')) NOT VALID,
  ADD CONSTRAINT "Notification_status_check"
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')) NOT VALID;

ALTER TABLE "BatchJob"
  ADD CONSTRAINT "BatchJob_status_check"
    CHECK (status IN ('PENDING', 'PROCESSING', 'RETRY', 'SUCCEEDED', 'FAILED')) NOT VALID,
  ADD CONSTRAINT "BatchJob_counters_check"
    CHECK ("failureAttempts" >= 0 AND "batchesProcessed" >= 0) NOT VALID;

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_rating_check"
    CHECK (rating BETWEEN 1 AND 5) NOT VALID,
  ADD CONSTRAINT "Review_moderationStatus_check"
    CHECK ("moderationStatus" IN ('PUBLISHED', 'HIDDEN')) NOT VALID;
