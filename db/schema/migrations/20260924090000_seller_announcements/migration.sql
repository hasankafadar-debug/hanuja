-- Seller announcements (e-mail plan phase 5): admin -> seller operational announcements with
-- image/video, a frozen recipient list and per-recipient delivery progress. Additive only.
-- New enum values use IF NOT EXISTS so a re-application is harmless.
-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('draft', 'sent');

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'announcement_sent';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'announcement_updated_after_send';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'announcement_retry_requested';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_announcement';

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "posterAssetId" TEXT,
    "audience" JSONB NOT NULL,
    "audienceHash" TEXT,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentTitle" TEXT,
    "sentBody" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentByAdminId" TEXT,
    "editedAfterSendAt" TIMESTAMP(3),
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_recipients" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "sellerId" TEXT,
    "sellerDeletedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "outboxWrittenAt" TIMESTAMP(3),
    "retryRequestedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_status_createdAt_idx" ON "announcements"("status", "createdAt");

-- CreateIndex
CREATE INDEX "announcements_mediaAssetId_idx" ON "announcements"("mediaAssetId");

-- CreateIndex
CREATE INDEX "announcements_posterAssetId_idx" ON "announcements"("posterAssetId");

-- CreateIndex
CREATE INDEX "announcement_recipients_outboxWrittenAt_createdAt_idx" ON "announcement_recipients"("outboxWrittenAt", "createdAt");

-- CreateIndex
CREATE INDEX "announcement_recipients_retryRequestedAt_idx" ON "announcement_recipients"("retryRequestedAt");

-- CreateIndex
CREATE INDEX "announcement_recipients_sellerId_readAt_idx" ON "announcement_recipients"("sellerId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_recipients_announcementId_sellerId_key" ON "announcement_recipients"("announcementId", "sellerId");

-- CreateIndex
CREATE INDEX "notification_deliveries_eventKey_idx" ON "notification_deliveries"("eventKey");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_posterAssetId_fkey" FOREIGN KEY ("posterAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

