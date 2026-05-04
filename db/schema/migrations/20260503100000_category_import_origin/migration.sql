-- AlterTable
ALTER TABLE "categories" ADD COLUMN "createdViaImportAt" TIMESTAMP(3),
ADD COLUMN "createdViaImportBy" TEXT;
