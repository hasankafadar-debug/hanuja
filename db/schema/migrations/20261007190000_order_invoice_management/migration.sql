-- Additive invoice lifecycle audit events, permanent seller correction window and cleanup queue.
ALTER TYPE "AdminActionType" ADD VALUE 'order_invoice_uploaded';
ALTER TYPE "AdminActionType" ADD VALUE 'order_invoice_replaced';
ALTER TYPE "AdminActionType" ADD VALUE 'order_invoice_removed';

CREATE TYPE "PrivateDocumentCleanupStatus" AS ENUM ('pending', 'completed');

CREATE TABLE "order_seller_invoice_policies" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "firstUploadedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_seller_invoice_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_seller_invoice_policies_orderId_sellerId_key"
  ON "order_seller_invoice_policies"("orderId", "sellerId");
CREATE INDEX "order_seller_invoice_policies_orderId_idx" ON "order_seller_invoice_policies"("orderId");
CREATE INDEX "order_seller_invoice_policies_sellerId_idx" ON "order_seller_invoice_policies"("sellerId");
ALTER TABLE "order_seller_invoice_policies" ADD CONSTRAINT "order_seller_invoice_policies_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_seller_invoice_policies" ADD CONSTRAINT "order_seller_invoice_policies_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- createdAt is the first persisted invoice date, unlike uploadedAt which changes on replacement.
INSERT INTO "order_seller_invoice_policies" ("id", "orderId", "sellerId", "firstUploadedAt", "createdAt", "updatedAt")
SELECT 'invoice_policy_' || "id", "orderId", "sellerId", "createdAt", "createdAt", CURRENT_TIMESTAMP
FROM "order_seller_invoices"
ON CONFLICT ("orderId", "sellerId") DO NOTHING;

CREATE TABLE "private_document_cleanups" (
  "id" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "status" "PrivateDocumentCleanupStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "private_document_cleanups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "private_document_cleanups_fileKey_key" ON "private_document_cleanups"("fileKey");
CREATE INDEX "private_document_cleanups_status_nextAttemptAt_idx" ON "private_document_cleanups"("status", "nextAttemptAt");
