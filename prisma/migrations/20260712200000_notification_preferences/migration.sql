ALTER TABLE "User" ADD COLUMN "notificationReminders" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notificationOffers" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
