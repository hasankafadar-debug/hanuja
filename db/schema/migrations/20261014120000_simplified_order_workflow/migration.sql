-- Existing warning code uses this value, but older migration history omitted it.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'fulfillment_warning_5days';
ALTER TYPE "NotificationType" ADD VALUE 'seller_return_shipped';
ALTER TYPE "NotificationType" ADD VALUE 'seller_return_decision';
ALTER TYPE "NotificationType" ADD VALUE 'seller_return_invoice_uploaded';
UPDATE "order_email_aliases" SET "status" = 'retired', "updatedAt" = CURRENT_TIMESTAMP WHERE "status" = 'active';
CREATE TABLE "seller_return_invoices" (
 "id" TEXT PRIMARY KEY, "returnRequestId" TEXT NOT NULL REFERENCES "return_requests"("id") ON DELETE RESTRICT,
 "sellerId" TEXT NOT NULL REFERENCES "sellers"("id") ON DELETE RESTRICT,
 "orderId" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
 "refundIds" JSONB NOT NULL, "invoiceNumber" TEXT NOT NULL, "invoiceDate" TIMESTAMP(3) NOT NULL,
 "amount" DECIMAL(12,2) NOT NULL, "vatGroups" JSONB NOT NULL,
 "fileKey" TEXT NOT NULL, "fileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL,
 "uploadedByAdminId" TEXT NOT NULL, "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "seller_return_invoices_returnRequestId_sellerId_key" ON "seller_return_invoices"("returnRequestId", "sellerId");
CREATE INDEX "seller_return_invoices_orderId_idx" ON "seller_return_invoices"("orderId");
