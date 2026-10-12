-- Satıcı Hanuja modeli (eklemeli): satıcının Hanuja'ya kestiği faturanın admin onayı,
-- Hanuja'nın müşteriye kestiği fatura, fatura hatırlatma/red bildirimleri ve denetim türleri.
CREATE TYPE "SellerInvoiceReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_invoice_approved';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_invoice_rejected';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_invoice_uploaded';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_invoice_replaced';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'customer_invoice_removed';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_invoice_reminder';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_invoice_rejected';

-- Mevcut faturalar onay bekler; vade yalnız admin onayındaki fatura tarihinden hesaplanır.
ALTER TABLE "order_seller_invoices"
  ADD COLUMN "invoiceNumber" TEXT,
  ADD COLUMN "invoiceDate" TIMESTAMP(3),
  ADD COLUMN "reviewStatus" "SellerInvoiceReviewStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByAdminId" TEXT,
  ADD COLUMN "reviewNote" TEXT;
CREATE INDEX "order_seller_invoices_reviewStatus_idx" ON "order_seller_invoices"("reviewStatus");

CREATE TABLE "order_customer_invoices" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "invoiceNumber" TEXT,
  "fileUrl" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_customer_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_customer_invoices_orderId_key" ON "order_customer_invoices"("orderId");
ALTER TABLE "order_customer_invoices" ADD CONSTRAINT "order_customer_invoices_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
