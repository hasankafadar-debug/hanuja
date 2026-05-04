-- Product barcode + seller-scope SKU uniqueness
ALTER TABLE "products"
ADD COLUMN "barcode" VARCHAR(13);

CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");
CREATE INDEX "products_barcode_idx" ON "products"("barcode");
CREATE UNIQUE INDEX "product_seller_sku_unique" ON "products"("sellerId", "sku");

-- Bank detail lifecycle
CREATE TYPE "BankDetailStatus" AS ENUM (
  'ACTIVE',
  'PENDING_ACTIVATION',
  'BLOCKED',
  'SUPERSEDED',
  'CANCELLED'
);

ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_bank_detail_approved';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_bank_detail_blocked';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_bank_detail_pending';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_bank_detail_activated';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_bank_detail_blocked';

ALTER TABLE "seller_bank_details"
ADD COLUMN "status" "BankDetailStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
ADD COLUMN "verifiedBy" TEXT,
ADD COLUMN "activatesAt" TIMESTAMP(3),
ADD COLUMN "stepUpVerifiedAt" TIMESTAMP(3),
ADD COLUMN "previousIbanMasked" TEXT,
ADD COLUMN "changeReason" TEXT,
ADD COLUMN "blockedReason" TEXT,
ADD COLUMN "blockedAt" TIMESTAMP(3),
ADD COLUMN "blockedBy" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "flags" JSONB;

UPDATE "seller_bank_details"
SET "status" = CASE
  WHEN "isActive" = TRUE THEN 'ACTIVE'::"BankDetailStatus"
  ELSE 'PENDING_ACTIVATION'::"BankDetailStatus"
END;

CREATE INDEX "seller_bank_details_sellerId_status_activatesAt_idx"
ON "seller_bank_details"("sellerId", "status", "activatesAt");

CREATE TABLE "seller_bank_detail_history" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "bankDetailId" TEXT,
  "action" TEXT NOT NULL,
  "ibanMasked" TEXT NOT NULL,
  "previousIbanMasked" TEXT,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_bank_detail_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "seller_bank_detail_history_sellerId_createdAt_idx"
ON "seller_bank_detail_history"("sellerId", "createdAt");

CREATE INDEX "seller_bank_detail_history_bankDetailId_idx"
ON "seller_bank_detail_history"("bankDetailId");

ALTER TABLE "seller_bank_detail_history"
ADD CONSTRAINT "seller_bank_detail_history_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "seller_bank_detail_history"
ADD CONSTRAINT "seller_bank_detail_history_bankDetailId_fkey"
FOREIGN KEY ("bankDetailId") REFERENCES "seller_bank_details"("id") ON DELETE SET NULL ON UPDATE CASCADE;
