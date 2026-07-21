CREATE TYPE "SellerDocumentIdentityPart" AS ENUM ('combined', 'front', 'back');

ALTER TABLE "seller_documents"
ADD COLUMN "identityPart" "SellerDocumentIdentityPart";

UPDATE "seller_documents"
SET "identityPart" = 'combined'
WHERE "type" = 'identity';

ALTER TABLE "seller_documents"
ADD CONSTRAINT "seller_documents_identity_part_type_check"
CHECK (
  ("type" = 'identity' AND "identityPart" IS NOT NULL)
  OR ("type" <> 'identity' AND "identityPart" IS NULL)
);

CREATE INDEX "seller_documents_sellerId_type_identityPart_idx"
ON "seller_documents"("sellerId", "type", "identityPart");
