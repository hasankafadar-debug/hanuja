-- CreateEnum
CREATE TYPE "HomePromoSlot" AS ENUM ('TOP_RIGHT', 'BOTTOM_RIGHT');

-- CreateEnum
CREATE TYPE "HomeCmsStatus" AS ENUM ('active', 'paused', 'scheduled', 'expired');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminActionType" ADD VALUE 'home_slide_created';
ALTER TYPE "AdminActionType" ADD VALUE 'home_slide_updated';
ALTER TYPE "AdminActionType" ADD VALUE 'home_slide_deleted';
ALTER TYPE "AdminActionType" ADD VALUE 'home_slide_reordered';
ALTER TYPE "AdminActionType" ADD VALUE 'home_promo_updated';

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "durationSec" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "story" TEXT;

-- CreateTable
CREATE TABLE "home_slides" (
    "id" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mediaAssetId" TEXT NOT NULL,
    "posterAssetId" TEXT,
    "eyebrow" VARCHAR(60),
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(300),
    "ctaLabel" VARCHAR(40) NOT NULL,
    "ctaHref" VARCHAR(500) NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sellerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "home_slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_promos" (
    "id" TEXT NOT NULL,
    "slot" "HomePromoSlot" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mediaAssetId" TEXT NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(160),
    "ctaHref" VARCHAR(500) NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "home_promos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "home_slides_isActive_sortOrder_idx" ON "home_slides"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "home_slides_startsAt_endsAt_idx" ON "home_slides"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "home_slides_sellerId_idx" ON "home_slides"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "home_promos_slot_key" ON "home_promos"("slot");

-- CreateIndex
CREATE INDEX "home_promos_slot_isActive_idx" ON "home_promos"("slot", "isActive");

-- AddForeignKey
ALTER TABLE "home_slides" ADD CONSTRAINT "home_slides_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_slides" ADD CONSTRAINT "home_slides_posterAssetId_fkey" FOREIGN KEY ("posterAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_slides" ADD CONSTRAINT "home_slides_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_promos" ADD CONSTRAINT "home_promos_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "product_seller_sku_unique" RENAME TO "products_sellerId_sku_key";
