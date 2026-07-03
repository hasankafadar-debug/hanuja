ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'admin_fulfillment_risk';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'store_discount_followed_seller';

ALTER TABLE "products"
  ADD COLUMN "fulfillmentDays" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "order_lines"
  ADD COLUMN "promisedFulfillmentDays" INTEGER,
  ADD COLUMN "fulfillmentDueAt" TIMESTAMP(3),
  ADD COLUMN "fulfilledAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "fulfillment_risks_orderId_key";

ALTER TABLE "fulfillment_risks"
  ADD COLUMN "orderLineId" TEXT;

CREATE UNIQUE INDEX "fulfillment_risks_orderLineId_key"
  ON "fulfillment_risks" ("orderLineId");

CREATE INDEX "fulfillment_risks_orderId_idx"
  ON "fulfillment_risks" ("orderId");

ALTER TABLE "fulfillment_risks"
  ADD CONSTRAINT "fulfillment_risks_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "penalties"
  ADD COLUMN "orderLineId" TEXT;

CREATE INDEX "penalties_orderLineId_idx"
  ON "penalties" ("orderLineId");

ALTER TABLE "penalties"
  ADD CONSTRAINT "penalties_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "store_follows" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "emailOptOutAt" TIMESTAMP(3),
  "emailOptOutToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_follows_emailOptOutToken_key"
  ON "store_follows" ("emailOptOutToken");

CREATE UNIQUE INDEX "store_follows_userId_sellerId_key"
  ON "store_follows" ("userId", "sellerId");

CREATE INDEX "store_follows_sellerId_createdAt_idx"
  ON "store_follows" ("sellerId", "createdAt");

ALTER TABLE "store_follows"
  ADD CONSTRAINT "store_follows_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_follows"
  ADD CONSTRAINT "store_follows_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "sellers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "store_discount_dispatches" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "discountRuleId" TEXT,
  "discountFingerprint" TEXT NOT NULL,
  "emailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_discount_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_discount_dispatches_userId_sellerId_discountFingerprint_key"
  ON "store_discount_dispatches" ("userId", "sellerId", "discountFingerprint");

CREATE INDEX "store_discount_dispatches_sellerId_createdAt_idx"
  ON "store_discount_dispatches" ("sellerId", "createdAt");

ALTER TABLE "store_discount_dispatches"
  ADD CONSTRAINT "store_discount_dispatches_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_discount_dispatches"
  ADD CONSTRAINT "store_discount_dispatches_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "sellers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
