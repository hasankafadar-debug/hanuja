-- AlterTable: Seller import permission flow
ALTER TABLE "sellers"
ADD COLUMN "importEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "importRequestedAt" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_import_permission_granted';
