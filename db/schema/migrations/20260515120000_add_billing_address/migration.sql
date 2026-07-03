-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('individual', 'corporate');

-- AlterTable: add billing address fields to addresses
ALTER TABLE "addresses"
  ADD COLUMN "isBillingAddress"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "invoiceType"       "InvoiceType",
  ADD COLUMN "tcNumber"          TEXT,
  ADD COLUMN "isForeignNational" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "companyName"       TEXT,
  ADD COLUMN "taxOffice"         TEXT,
  ADD COLUMN "taxNumber"         TEXT;

-- AlterTable: add billingAddressId to orders
ALTER TABLE "orders"
  ADD COLUMN "billingAddressId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_billingAddressId_fkey"
  FOREIGN KEY ("billingAddressId") REFERENCES "addresses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
