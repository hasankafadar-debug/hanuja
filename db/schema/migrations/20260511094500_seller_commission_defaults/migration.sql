ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_commission_rate_changed';

ALTER TABLE "platform_settings"
ADD COLUMN "defaultSellerCommissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0.1500;

ALTER TABLE "sellers"
ADD COLUMN "commissionRateOverride" DECIMAL(5,4);
