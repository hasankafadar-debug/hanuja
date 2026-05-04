DROP INDEX IF EXISTS "products_sellerId_sku_key";
DROP INDEX IF EXISTS "product_seller_sku_unique";

CREATE INDEX IF NOT EXISTS "products_sellerId_sku_idx" ON "products"("sellerId", "sku");
