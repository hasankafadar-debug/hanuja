-- CreateEnum
CREATE TYPE "SellerDocumentType" AS ENUM ('identity', 'tax_certificate', 'trade_registry', 'signature_circular', 'bank_statement', 'other');

-- CreateEnum
CREATE TYPE "SellerDocumentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminActionType" ADD VALUE 'seller_bank_detail_changed';
ALTER TYPE "AdminActionType" ADD VALUE 'seller_document_approved';
ALTER TYPE "AdminActionType" ADD VALUE 'seller_document_rejected';

-- CreateTable
CREATE TABLE "seller_documents" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "SellerDocumentType" NOT NULL,
    "status" "SellerDocumentStatus" NOT NULL DEFAULT 'pending',
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "adminNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_documents_sellerId_idx" ON "seller_documents"("sellerId");

-- CreateIndex
CREATE INDEX "seller_documents_sellerId_type_idx" ON "seller_documents"("sellerId", "type");

-- CreateIndex
CREATE INDEX "seller_documents_status_idx" ON "seller_documents"("status");

-- AddForeignKey
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
