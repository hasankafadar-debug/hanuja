-- Migration: add MediaAssetKind enum + kind/variants/width/height to media_assets

CREATE TYPE "MediaAssetKind" AS ENUM ('image', 'document', 'video');

ALTER TABLE "media_assets"
  ADD COLUMN "kind"     "MediaAssetKind" NOT NULL DEFAULT 'image',
  ADD COLUMN "width"    INTEGER,
  ADD COLUMN "height"   INTEGER,
  ADD COLUMN "variants" JSONB;
