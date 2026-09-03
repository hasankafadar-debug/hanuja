ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_refund_completed';

CREATE TYPE "NotificationChannel" AS ENUM ('in_app', 'email');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('pending', 'processing', 'sent', 'failed');

CREATE TABLE "notification_deliveries" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
  "notificationId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_deliveries_recipient_channel_eventKey_key"
  ON "notification_deliveries"("recipient", "channel", "eventKey");
CREATE INDEX "notification_deliveries_status_createdAt_idx"
  ON "notification_deliveries"("status", "createdAt");
CREATE INDEX "notification_deliveries_userId_createdAt_idx"
  ON "notification_deliveries"("userId", "createdAt");

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
