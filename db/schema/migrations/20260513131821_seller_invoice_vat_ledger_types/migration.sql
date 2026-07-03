/*
  Warnings:

  - Added the required column `grossInvoiceAmount` to the `seller_invoices` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'commission_invoice_issued';
ALTER TYPE "LedgerEntryType" ADD VALUE 'penalty_invoice_issued';

-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "commissionExemptedAt" TIMESTAMP(3),
ADD COLUMN     "commissionExemptedBy" TEXT,
ADD COLUMN     "commissionExemptedReason" TEXT,
ADD COLUMN     "commissionInvoiceId" TEXT;

-- AlterTable
-- grossInvoiceAmount is added nullable first so existing rows survive, then
-- backfilled (gross = amount + vatAmount, with vatAmount defaulting to 0),
-- and finally constrained to NOT NULL. This makes the migration safe on
-- non-empty tables.
ALTER TABLE "seller_invoices" ADD COLUMN "grossInvoiceAmount" DECIMAL(12,2);
ALTER TABLE "seller_invoices" ADD COLUMN "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "seller_invoices" ADD COLUMN "vatRate" DECIMAL(5,4) NOT NULL DEFAULT 0;

UPDATE "seller_invoices"
SET "grossInvoiceAmount" = "amount" + COALESCE("vatAmount", 0)
WHERE "grossInvoiceAmount" IS NULL;

ALTER TABLE "seller_invoices" ALTER COLUMN "grossInvoiceAmount" SET NOT NULL;

-- CreateIndex
CREATE INDEX "order_lines_commissionInvoiceId_idx" ON "order_lines"("commissionInvoiceId");

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_commissionInvoiceId_fkey" FOREIGN KEY ("commissionInvoiceId") REFERENCES "seller_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
