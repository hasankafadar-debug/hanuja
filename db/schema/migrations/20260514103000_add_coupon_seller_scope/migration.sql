ALTER TABLE "coupons"
ADD COLUMN "sellerId" TEXT;

CREATE INDEX "coupons_sellerId_idx"
ON "coupons"("sellerId");

ALTER TABLE "coupons"
ADD CONSTRAINT "coupons_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "sellers"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
