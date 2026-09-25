ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_campaign_created';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_campaign_updated';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_campaign_deleted';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_campaign_copied';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_campaign_submitted';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_campaign_retry_requested';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'customer_campaign';
ALTER TYPE "CampaignDispatchSource" ADD VALUE IF NOT EXISTS 'customer_campaign';

CREATE TYPE "CustomerCampaignChannel" AS ENUM ('email', 'sms');
CREATE TYPE "CustomerCampaignStatus" AS ENUM ('draft', 'submitted');

CREATE TABLE "customer_campaigns" (
  "id" TEXT NOT NULL,
  "channel" "CustomerCampaignChannel" NOT NULL DEFAULT 'email',
  "status" "CustomerCampaignStatus" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "ctaLabel" TEXT,
  "ctaUrl" TEXT,
  "mediaAssetId" TEXT,
  "posterAssetId" TEXT,
  "audience" JSONB NOT NULL,
  "audienceHash" TEXT,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "submittedContent" JSONB,
  "submittedAt" TIMESTAMP(3),
  "submittedByAdminId" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_campaign_recipients" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT,
  "userDeletedAt" TIMESTAMP(3),
  "email" TEXT,
  "phone" TEXT,
  "eventKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "statusReason" TEXT,
  "deliveryId" TEXT,
  "outboxWrittenAt" TIMESTAMP(3),
  "retryRequestedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_campaigns_status_createdAt_idx" ON "customer_campaigns"("status", "createdAt");
CREATE INDEX "customer_campaigns_channel_createdAt_idx" ON "customer_campaigns"("channel", "createdAt");
CREATE INDEX "customer_campaigns_mediaAssetId_idx" ON "customer_campaigns"("mediaAssetId");
CREATE INDEX "customer_campaigns_posterAssetId_idx" ON "customer_campaigns"("posterAssetId");
CREATE UNIQUE INDEX "customer_campaign_recipients_eventKey_key" ON "customer_campaign_recipients"("eventKey");
CREATE UNIQUE INDEX "customer_campaign_recipients_campaignId_userId_key" ON "customer_campaign_recipients"("campaignId", "userId");
CREATE INDEX "customer_campaign_recipients_campaignId_status_idx" ON "customer_campaign_recipients"("campaignId", "status");
CREATE INDEX "customer_campaign_recipients_outboxWrittenAt_submittedAt_idx" ON "customer_campaign_recipients"("outboxWrittenAt", "submittedAt");
CREATE INDEX "customer_campaign_recipients_retryRequestedAt_idx" ON "customer_campaign_recipients"("retryRequestedAt");
CREATE INDEX "customer_campaign_recipients_userId_idx" ON "customer_campaign_recipients"("userId");

ALTER TABLE "customer_campaigns" ADD CONSTRAINT "customer_campaigns_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_campaigns" ADD CONSTRAINT "customer_campaigns_posterAssetId_fkey" FOREIGN KEY ("posterAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_campaign_recipients" ADD CONSTRAINT "customer_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "customer_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_campaign_recipients" ADD CONSTRAINT "customer_campaign_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
