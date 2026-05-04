-- Public numeric order numbers
ALTER TABLE "orders" ADD COLUMN "publicNumber" INTEGER;

CREATE SEQUENCE "orders_publicNumber_seq" START WITH 231654 INCREMENT BY 1;

WITH numbered AS (
  SELECT
    "id",
    231653 + ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS "nextNumber"
  FROM "orders"
)
UPDATE "orders"
SET "publicNumber" = numbered."nextNumber"
FROM numbered
WHERE "orders"."id" = numbered."id";

SELECT setval(
  '"orders_publicNumber_seq"',
  COALESCE((SELECT MAX("publicNumber") FROM "orders"), 231653)
);

ALTER SEQUENCE "orders_publicNumber_seq" OWNED BY "orders"."publicNumber";
ALTER TABLE "orders" ALTER COLUMN "publicNumber" SET DEFAULT nextval('"orders_publicNumber_seq"');
ALTER TABLE "orders" ALTER COLUMN "publicNumber" SET NOT NULL;

CREATE UNIQUE INDEX "orders_publicNumber_key" ON "orders"("publicNumber");
CREATE INDEX "orders_publicNumber_idx" ON "orders"("publicNumber");

-- Variant barcodes
ALTER TABLE "product_variants" ADD COLUMN "barcode" VARCHAR(13);

WITH numbered_variants AS (
  SELECT
    "id",
    '990' || LPAD((ROW_NUMBER() OVER (ORDER BY "createdAt", "id"))::TEXT, 10, '0') AS "generatedBarcode"
  FROM "product_variants"
)
UPDATE "product_variants"
SET "barcode" = numbered_variants."generatedBarcode"
FROM numbered_variants
WHERE "product_variants"."id" = numbered_variants."id";

ALTER TABLE "product_variants" ALTER COLUMN "barcode" SET NOT NULL;
CREATE UNIQUE INDEX "product_variants_barcode_key" ON "product_variants"("barcode");
CREATE INDEX "product_variants_barcode_idx" ON "product_variants"("barcode");

-- Support attachments
ALTER TYPE "MediaAssetType" ADD VALUE 'support_attachment';

CREATE TABLE "support_message_attachments" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "support_message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_message_attachments_messageId_mediaAssetId_key"
ON "support_message_attachments"("messageId", "mediaAssetId");

CREATE INDEX "support_message_attachments_messageId_idx"
ON "support_message_attachments"("messageId");

CREATE INDEX "support_message_attachments_mediaAssetId_idx"
ON "support_message_attachments"("mediaAssetId");

ALTER TABLE "support_message_attachments"
ADD CONSTRAINT "support_message_attachments_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "support_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_message_attachments"
ADD CONSTRAINT "support_message_attachments_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
