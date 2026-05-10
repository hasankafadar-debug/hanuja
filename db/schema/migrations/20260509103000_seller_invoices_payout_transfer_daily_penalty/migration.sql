CREATE TYPE "OrderCancellationReason" AS ENUM (
    'customer_requested',
    'admin_cancelled',
    'payment_failed',
    'seller_rejected',
    'auto_canceled_20day_breach',
    'other'
);

CREATE TYPE "SellerInvoiceType" AS ENUM ('commission', 'penalty');

ALTER TYPE "PenaltyReason" ADD VALUE IF NOT EXISTS 'late_shipment_daily_accrual';

ALTER TABLE "platform_settings"
ADD COLUMN "eftDiscountRate" DECIMAL(5,4) NOT NULL DEFAULT 0;

ALTER TABLE "orders"
ADD COLUMN "cancellationReason" "OrderCancellationReason",
ADD COLUMN "netSubtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "taxBreakdownJson" JSONB,
ADD COLUMN "eftDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "eftDiscountRateSnapshot" DECIMAL(5,4);

UPDATE "orders"
SET "netSubtotal" = GREATEST("grossAmount" - "taxAmount", 0);

ALTER TABLE "payouts"
ADD COLUMN "transferReference" TEXT,
ADD COLUMN "transferDate" TIMESTAMP(3),
ADD COLUMN "transferBankName" TEXT,
ADD COLUMN "transferNote" TEXT,
ADD COLUMN "paidByAdminId" TEXT,
ADD COLUMN "ibanSnapshot" TEXT,
ADD COLUMN "accountHolderSnapshot" TEXT;

ALTER TABLE "payouts"
ADD CONSTRAINT "payouts_paidByAdminId_fkey"
FOREIGN KEY ("paidByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payouts_paidByAdminId_idx" ON "payouts"("paidByAdminId");

ALTER TABLE "penalties"
ADD COLUMN "accrualSourceDate" TIMESTAMP(3),
ADD COLUMN "accrualDayCount" INTEGER,
ADD COLUMN "dailyAccrualRate" DECIMAL(5,4) DEFAULT 0.0100,
ADD COLUMN "lastAccrualAt" TIMESTAMP(3);

CREATE TABLE "seller_invoices" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "SellerInvoiceType" NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "invoiceCategory" TEXT,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "sourceOrderId" TEXT,
    "sourcePenaltyId" TEXT,
    "payoutId" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_invoices_invoiceNumber_key" ON "seller_invoices"("invoiceNumber");
CREATE INDEX "seller_invoices_sellerId_type_idx" ON "seller_invoices"("sellerId", "type");
CREATE INDEX "seller_invoices_sourceOrderId_idx" ON "seller_invoices"("sourceOrderId");
CREATE INDEX "seller_invoices_sourcePenaltyId_idx" ON "seller_invoices"("sourcePenaltyId");
CREATE INDEX "seller_invoices_payoutId_idx" ON "seller_invoices"("payoutId");
CREATE INDEX "seller_invoices_createdByAdminId_idx" ON "seller_invoices"("createdByAdminId");

ALTER TABLE "seller_invoices"
ADD CONSTRAINT "seller_invoices_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seller_invoices"
ADD CONSTRAINT "seller_invoices_sourceOrderId_fkey"
FOREIGN KEY ("sourceOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "seller_invoices"
ADD CONSTRAINT "seller_invoices_sourcePenaltyId_fkey"
FOREIGN KEY ("sourcePenaltyId") REFERENCES "penalties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "seller_invoices"
ADD CONSTRAINT "seller_invoices_payoutId_fkey"
FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "seller_invoices"
ADD CONSTRAINT "seller_invoices_createdByAdminId_fkey"
FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
