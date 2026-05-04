ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_bank_detail_approved';

ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "moderationFindings" JSONB;
