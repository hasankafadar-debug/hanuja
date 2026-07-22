BEGIN;

-- This must be the first DDL-adjacent operation.  Do not silently choose an
-- owner for a crossed product / variant barcode.
DO $$
DECLARE conflicts TEXT;
BEGIN
  SELECT string_agg(barcode, ', ' ORDER BY barcode) INTO conflicts
  FROM (
    SELECT p."barcode" AS barcode
    FROM "products" p
    INNER JOIN "product_variants" v ON v."barcode" = p."barcode"
    WHERE p."barcode" IS NOT NULL
  ) crossed;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create barcode registry: product/variant barcode conflicts: %', conflicts;
  END IF;
END $$;

-- Model codes replace the former SKU-as-family-key behaviour.  Keep a
-- database-generated LEGACY fallback so an older application binary cannot
-- insert a NULL model code while the migration is rolling out.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "products"
  ADD COLUMN "modelCode" VARCHAR(120)
  NOT NULL DEFAULT ('LEGACY-' || gen_random_uuid()::text);

UPDATE "products"
SET "modelCode" = UPPER(REGEXP_REPLACE(BTRIM("sku"), '[[:space:]]+', ' ', 'g'))
WHERE "sku" IS NOT NULL AND BTRIM("sku") <> '';

CREATE INDEX "products_sellerId_categoryId_modelCode_idx"
  ON "products"("sellerId", "categoryId", "modelCode");

CREATE TABLE "barcode_registry" (
  "barcode" VARCHAR(13) PRIMARY KEY,
  "productId" TEXT UNIQUE,
  "variantId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "barcode_registry_exactly_one_owner"
    CHECK (("productId" IS NOT NULL)::int + ("variantId" IS NOT NULL)::int = 1),
  CONSTRAINT "barcode_registry_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "barcode_registry_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "barcode_registry" ("barcode", "productId")
SELECT "barcode", "id" FROM "products" WHERE "barcode" IS NOT NULL;

INSERT INTO "barcode_registry" ("barcode", "variantId")
SELECT "barcode", "id" FROM "product_variants";

-- Database triggers keep the registry authoritative for legacy binaries,
-- seed scripts, and direct SQL writers.  Application-level helpers repeat
-- the operation safely to present friendly conflict messages before commit.
CREATE OR REPLACE FUNCTION "sync_barcode_registry"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM "barcode_registry" WHERE "productId" = OLD."id";
      RETURN OLD;
    END IF;
    DELETE FROM "barcode_registry" WHERE "productId" = NEW."id";
    IF NEW."barcode" IS NOT NULL THEN
      INSERT INTO "barcode_registry" ("barcode", "productId") VALUES (NEW."barcode", NEW."id");
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM "barcode_registry" WHERE "variantId" = OLD."id";
    RETURN OLD;
  END IF;
  DELETE FROM "barcode_registry" WHERE "variantId" = NEW."id";
  INSERT INTO "barcode_registry" ("barcode", "variantId") VALUES (NEW."barcode", NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_barcode_registry_sync"
AFTER INSERT OR UPDATE OF "barcode" OR DELETE ON "products"
FOR EACH ROW EXECUTE FUNCTION "sync_barcode_registry"();

CREATE TRIGGER "product_variants_barcode_registry_sync"
AFTER INSERT OR UPDATE OF "barcode" OR DELETE ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION "sync_barcode_registry"();

COMMIT;
