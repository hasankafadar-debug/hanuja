-- All product writers enforce brand and the Mosaiss backfill was verified before this release.
ALTER TABLE "products" ALTER COLUMN "brand" SET NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_brand_not_blank" CHECK ("brand" ~ '[^[:space:]]');
