ALTER TYPE "AdminActionType" ADD VALUE 'notification_retry_requested';

ALTER TABLE "notification_deliveries"
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "smtpAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "messageId" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "transportStatus" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "providerEventAt" TIMESTAMP(3),
  ADD COLUMN "payload" JSONB;
-- Historical deliveredAt meant SMTP acceptance, not mailbox delivery.
UPDATE "notification_deliveries" SET "smtpAcceptedAt" = "deliveredAt", "deliveredAt" = NULL WHERE "channel" = 'email';
CREATE UNIQUE INDEX "notification_deliveries_messageId_key" ON "notification_deliveries"("messageId");
CREATE INDEX "notification_deliveries_providerMessageId_idx" ON "notification_deliveries"("providerMessageId");
CREATE INDEX "notification_deliveries_status_leaseExpiresAt_idx" ON "notification_deliveries"("status", "leaseExpiresAt");

CREATE TABLE "notification_outbox" (
  "id" TEXT NOT NULL, "eventKey" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL, "payload" JSONB NOT NULL, "lane" TEXT NOT NULL DEFAULT 'transactional',
  "status" TEXT NOT NULL DEFAULT 'pending', "generation" INTEGER NOT NULL DEFAULT 0,
  "queuedAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_outbox_userId_type_eventKey_key" ON "notification_outbox"("userId", "type", "eventKey");
CREATE INDEX "notification_outbox_status_queuedAt_idx" ON "notification_outbox"("status", "queuedAt");

CREATE TABLE "email_provider_events" (
  "id" TEXT NOT NULL, "providerMessageId" TEXT NOT NULL, "messageId" TEXT, "type" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_provider_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_provider_events_providerMessageId_idx" ON "email_provider_events"("providerMessageId");
CREATE INDEX "email_provider_events_messageId_idx" ON "email_provider_events"("messageId");
