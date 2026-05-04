-- Add missing product care instructions field
ALTER TABLE "products" ADD COLUMN "careInstructions" TEXT;

-- Create discount enums
CREATE TYPE "DiscountRuleScope" AS ENUM ('ALL_PRODUCTS', 'CATEGORY', 'PRODUCT');
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT');
CREATE TYPE "DiscountStatus" AS ENUM ('ACTIVE', 'SCHEDULED', 'EXPIRED', 'PAUSED');

-- Create discount tables
CREATE TABLE "discount_rules" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "DiscountRuleScope" NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "categoryId" TEXT,
    "status" "DiscountStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discount_rule_products" (
    "discountRuleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "discount_rule_products_pkey" PRIMARY KEY ("discountRuleId","productId")
);

-- Create indexes
CREATE INDEX "discount_rules_sellerId_status_idx" ON "discount_rules"("sellerId", "status");
CREATE INDEX "discount_rules_categoryId_idx" ON "discount_rules"("categoryId");
CREATE INDEX "discount_rule_products_productId_idx" ON "discount_rule_products"("productId");

-- Add foreign keys
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discount_rule_products" ADD CONSTRAINT "discount_rule_products_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "discount_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discount_rule_products" ADD CONSTRAINT "discount_rule_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
