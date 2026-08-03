ALTER TABLE "seller_documents"
ADD COLUMN "uploadGroupId" TEXT,
ADD COLUMN "uploadOrder" INTEGER,
ADD COLUMN "uploadGroupSize" INTEGER;

ALTER TABLE "seller_documents"
ADD CONSTRAINT "seller_documents_contract_upload_group_check"
CHECK (
  (
    "type" = 'contract'
    AND "uploadGroupId" IS NOT NULL
    AND "uploadOrder" IS NOT NULL
    AND "uploadGroupSize" IS NOT NULL
    AND "uploadGroupSize" > 0
    AND "uploadOrder" >= 0
    AND "uploadOrder" < "uploadGroupSize"
  )
  OR
  (
    "type" <> 'contract'
    AND "uploadGroupId" IS NULL
    AND "uploadOrder" IS NULL
    AND "uploadGroupSize" IS NULL
  )
);

CREATE INDEX "seller_documents_sellerId_type_uploadGroupId_idx"
ON "seller_documents"("sellerId", "type", "uploadGroupId");

CREATE UNIQUE INDEX "seller_documents_one_pending_contract_group_per_seller"
ON "seller_documents"("sellerId")
WHERE "type" = 'contract' AND "status" = 'pending' AND "uploadOrder" = 0;
