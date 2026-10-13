CREATE TABLE "catalog_fields" (
  "key" TEXT PRIMARY KEY, "label" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "canonicalUnit" TEXT, "config" JSONB NOT NULL DEFAULT '{}',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE, "everUsed" BOOLEAN NOT NULL DEFAULT FALSE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "catalog_templates" (
  "code" TEXT PRIMARY KEY, "label" TEXT NOT NULL,
  "compatibilityVersion" INTEGER NOT NULL DEFAULT 1, "config" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "categories" ADD COLUMN "templateCode" TEXT REFERENCES "catalog_templates"("code");
ALTER TABLE "products" ADD COLUMN "firstPublishedAt" TIMESTAMP(3),
  ADD COLUMN "properties" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "product_variants" ADD COLUMN "properties" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "search_index_dirty_products" (
  "productId" TEXT PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "search_index_dirty_products_updatedAt_idx" ON "search_index_dirty_products"("updatedAt");

-- Publication protection is installed with the evidence view in the next migration.

CREATE FUNCTION mark_product_search_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    pid := CASE WHEN TG_OP = 'DELETE' THEN OLD."productId" ELSE NEW."productId" END;
  END IF;
  INSERT INTO "search_index_dirty_products" ("productId", "revision", "updatedAt")
    VALUES (pid, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("productId") DO UPDATE SET
      "revision" = "search_index_dirty_products"."revision" + 1,
      "updatedAt" = CURRENT_TIMESTAMP;
  IF TG_TABLE_NAME IN ('products', 'product_variants') AND TG_OP <> 'DELETE' THEN
    UPDATE "catalog_fields" SET "everUsed" = TRUE
      WHERE "everUsed" = FALSE AND "key" IN (SELECT jsonb_object_keys(NEW.properties));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER products_search_dirty AFTER INSERT OR UPDATE OR DELETE ON "products"
  FOR EACH ROW EXECUTE FUNCTION mark_product_search_dirty();
CREATE TRIGGER variants_search_dirty AFTER INSERT OR UPDATE OR DELETE ON "product_variants"
  FOR EACH ROW EXECUTE FUNCTION mark_product_search_dirty();
CREATE TRIGGER attributes_search_dirty AFTER INSERT OR UPDATE OR DELETE ON "product_attribute_values"
  FOR EACH ROW EXECUTE FUNCTION mark_product_search_dirty();
