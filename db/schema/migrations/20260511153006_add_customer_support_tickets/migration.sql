-- CreateEnum
CREATE TYPE "CustomerSupportTicketStatus" AS ENUM ('waiting_for_admin', 'waiting_for_customer', 'resolved');

-- CreateEnum
CREATE TYPE "CustomerSupportCategory" AS ENUM ('shipping_delay', 'damaged_product', 'wrong_product', 'invoice_issue', 'payment_issue', 'return_or_exchange', 'other');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminActionType" ADD VALUE 'customer_support_replied';
ALTER TYPE "AdminActionType" ADD VALUE 'customer_support_resolved';
ALTER TYPE "AdminActionType" ADD VALUE 'customer_support_reopened';

-- AlterEnum
ALTER TYPE "MediaAssetType" ADD VALUE 'customer_support_attachment';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'customer_support_reply';
ALTER TYPE "NotificationType" ADD VALUE 'customer_support_resolved_notify';
ALTER TYPE "NotificationType" ADD VALUE 'admin_customer_support_new';
ALTER TYPE "NotificationType" ADD VALUE 'admin_customer_support_reply';

-- AlterTable
ALTER TABLE "fulfillment_risks" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "seller_invoices" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "customer_support_tickets" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "category" "CustomerSupportCategory" NOT NULL,
    "subject" VARCHAR(120) NOT NULL,
    "status" "CustomerSupportTicketStatus" NOT NULL DEFAULT 'waiting_for_admin',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "lastCustomerMessageAt" TIMESTAMP(3),
    "lastAdminMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_support_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "UserRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_support_message_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_support_message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_support_tickets_customerId_createdAt_idx" ON "customer_support_tickets"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_support_tickets_orderId_idx" ON "customer_support_tickets"("orderId");

-- CreateIndex
CREATE INDEX "customer_support_tickets_status_updatedAt_idx" ON "customer_support_tickets"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "customer_support_messages_ticketId_createdAt_idx" ON "customer_support_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_support_messages_authorId_idx" ON "customer_support_messages"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_support_message_attachments_messageId_mediaAssetId_key" ON "customer_support_message_attachments"("messageId", "mediaAssetId");

-- AddForeignKey
ALTER TABLE "customer_support_tickets" ADD CONSTRAINT "customer_support_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_support_tickets" ADD CONSTRAINT "customer_support_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_support_tickets" ADD CONSTRAINT "customer_support_tickets_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_support_messages" ADD CONSTRAINT "customer_support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "customer_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_support_messages" ADD CONSTRAINT "customer_support_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_support_message_attachments" ADD CONSTRAINT "customer_support_message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "customer_support_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_support_message_attachments" ADD CONSTRAINT "customer_support_message_attachments_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
