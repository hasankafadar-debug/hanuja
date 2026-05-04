-- Add ProductReview model + product aggregate fields
-- Reviews are gated by content moderation (06-content-guidelines)
-- Eligibility enforced in service layer: order must be delivery_confirmed and customer-owned

-- Notification + admin action enum extensions
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'product_review_pending_moderation';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'product_review_approved';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'product_review_rejected';

ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'product_review_approved';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'product_review_rejected';

-- Review moderation status enum
DO $$ BEGIN
  CREATE TYPE "ProductReviewStatus" AS ENUM ('pending_moderation', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Product aggregate fields (recomputed when a review is approved/rejected)
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "avgRating" DECIMAL(3, 2),
  ADD COLUMN IF NOT EXISTS "reviewCount" INTEGER NOT NULL DEFAULT 0;

-- ProductReview table
CREATE TABLE IF NOT EXISTS "product_reviews" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "title" VARCHAR(140),
  "body" TEXT NOT NULL,
  "status" "ProductReviewStatus" NOT NULL DEFAULT 'pending_moderation',
  "moderatedBy" TEXT,
  "moderatedAt" TIMESTAMP(3),
  "moderationNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_reviews_rating_range_chk" CHECK ("rating" >= 1 AND "rating" <= 5)
);

-- Indexes — listing per product (status filter), admin moderation queue, unique per order+product
CREATE INDEX IF NOT EXISTS "product_reviews_productId_status_createdAt_idx"
  ON "product_reviews"("productId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "product_reviews_status_createdAt_idx"
  ON "product_reviews"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "product_reviews_orderId_productId_key"
  ON "product_reviews"("orderId", "productId");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "product_reviews"
  ADD CONSTRAINT "product_reviews_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_reviews"
  ADD CONSTRAINT "product_reviews_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_reviews"
  ADD CONSTRAINT "product_reviews_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
