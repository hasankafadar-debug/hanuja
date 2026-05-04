CREATE SEQUENCE IF NOT EXISTS "sellers_sellerNumber_seq";

ALTER TABLE "sellers" ADD COLUMN "sellerNumber" INTEGER;

WITH ordered_sellers AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::INTEGER AS "sellerNumber"
  FROM "sellers"
)
UPDATE "sellers"
SET "sellerNumber" = ordered_sellers."sellerNumber"
FROM ordered_sellers
WHERE "sellers"."id" = ordered_sellers."id";

SELECT setval(
  '"sellers_sellerNumber_seq"',
  COALESCE((SELECT MAX("sellerNumber") FROM "sellers"), 0) + 1,
  false
);

ALTER TABLE "sellers" ALTER COLUMN "sellerNumber" SET DEFAULT nextval('"sellers_sellerNumber_seq"');
ALTER TABLE "sellers" ALTER COLUMN "sellerNumber" SET NOT NULL;
ALTER SEQUENCE "sellers_sellerNumber_seq" OWNED BY "sellers"."sellerNumber";

CREATE UNIQUE INDEX "sellers_sellerNumber_key" ON "sellers"("sellerNumber");
