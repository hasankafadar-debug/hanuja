-- Lowest-price-of-15-days notifications (e-mail plan phase 6). Additive only.
--
-- * product_price_history: effective (KDV-inclusive, discount-rule-applied) price per price key.
--   Rule start/end boundaries are written ahead as `predicted` rows with their exact times; a
--   later write cancels future predictions instead of deleting them.
-- * price_change_markers: written by the triggers below for EVERY price-relevant change,
--   whatever wrote it (application, seed, CLI, SQL migration, manual edit). The application
--   recorder states what it recorded in price_change_explanations; a marker without an
--   explanation resets the trust of the affected price keys (price_key_tracking).
-- * campaign_email_dispatches gains a reservation lifecycle. Rows written before this migration
--   are backfilled as `sent` so they keep counting toward the shared limits.
--
-- New enum values use IF NOT EXISTS so a re-application is harmless. They are not used in this
-- migration (PostgreSQL forbids using a value added in the same transaction).

-- CreateEnum
CREATE TYPE "CampaignDispatchStatus" AS ENUM ('reserved', 'sending', 'sent', 'uncertain', 'released');

-- CreateEnum
CREATE TYPE "PriceHistorySource" AS ENUM ('baseline', 'product_write', 'variant_write', 'discount_rule_write', 'rule_boundary', 'reconcile');

-- CreateEnum
CREATE TYPE "PriceDropEventStatus" AS ENUM ('candidate', 'ineligible', 'grouped', 'pending', 'dispatching', 'dispatched', 'cancelled');

-- CreateEnum
CREATE TYPE "PriceDropRecipientStatus" AS ENUM ('awaiting_capacity', 'reserved', 'skipped');

-- AlterEnum
ALTER TYPE "CampaignDispatchSource" ADD VALUE IF NOT EXISTS 'price_drop';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'product_price_drop';

-- AlterTable
ALTER TABLE "campaign_email_dispatches" ADD COLUMN     "eventKey" TEXT,
ADD COLUMN     "releaseReason" TEXT,
ADD COLUMN     "sendingAt" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" "CampaignDispatchStatus" NOT NULL DEFAULT 'reserved',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Pre-phase-6 rows were written when the e-mail was handed to the notification service; treat
-- them as sent so the 7-day and 24-hour limits stay conservative.
UPDATE "campaign_email_dispatches"
SET "status" = 'sent', "sentAt" = COALESCE("emailSentAt", "createdAt");

-- CreateTable
CREATE TABLE "product_price_history" (
    "seq" BIGSERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "variantId" TEXT,
    "priceKey" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "discountRuleId" TEXT,
    "source" "PriceHistorySource" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "predicted" BOOLEAN NOT NULL DEFAULT false,
    "materializedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "txId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_price_history_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "price_key_tracking" (
    "priceKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "trackedSince" TIMESTAMP(3) NOT NULL,
    "lastResetAt" TIMESTAMP(3),
    "lastResetReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_key_tracking_pkey" PRIMARY KEY ("priceKey")
);

-- CreateTable
CREATE TABLE "price_change_markers" (
    "id" BIGSERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "productId" TEXT,
    "sellerId" TEXT,
    "ruleId" TEXT,
    "txId" BIGINT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "price_change_markers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_change_explanations" (
    "txId" BIGINT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_change_explanations_pkey" PRIMARY KEY ("txId","entityType","entityId")
);

-- CreateTable
CREATE TABLE "price_drop_events" (
    "id" TEXT NOT NULL,
    "historySeq" BIGINT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "priceKey" TEXT NOT NULL,
    "variantId" TEXT,
    "previousPrice" DECIMAL(12,2) NOT NULL,
    "newPrice" DECIMAL(12,2) NOT NULL,
    "windowMinPrice" DECIMAL(12,2),
    "changeAt" TIMESTAMP(3) NOT NULL,
    "status" "PriceDropEventStatus" NOT NULL DEFAULT 'candidate',
    "reason" TEXT,
    "primaryEventId" TEXT,
    "audienceFrozenAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "evaluatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_drop_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_drop_recipients" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PriceDropRecipientStatus" NOT NULL DEFAULT 'awaiting_capacity',
    "skipReason" TEXT,
    "reservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_drop_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_price_history_priceKey_recordedAt_idx" ON "product_price_history"("priceKey", "recordedAt");

-- CreateIndex
CREATE INDEX "product_price_history_predicted_materializedAt_recordedAt_idx" ON "product_price_history"("predicted", "materializedAt", "recordedAt");

-- CreateIndex
CREATE INDEX "product_price_history_productId_recordedAt_idx" ON "product_price_history"("productId", "recordedAt");

-- CreateIndex
CREATE INDEX "price_key_tracking_productId_idx" ON "price_key_tracking"("productId");

-- CreateIndex
CREATE INDEX "price_change_markers_processedAt_id_idx" ON "price_change_markers"("processedAt", "id");

-- CreateIndex
CREATE INDEX "price_change_markers_productId_processedAt_idx" ON "price_change_markers"("productId", "processedAt");

-- CreateIndex
CREATE INDEX "price_change_markers_sellerId_processedAt_idx" ON "price_change_markers"("sellerId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "price_drop_events_historySeq_key" ON "price_drop_events"("historySeq");

-- CreateIndex
CREATE INDEX "price_drop_events_status_createdAt_idx" ON "price_drop_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "price_drop_events_productId_changeAt_idx" ON "price_drop_events"("productId", "changeAt");

-- CreateIndex
CREATE INDEX "price_drop_recipients_eventId_status_id_idx" ON "price_drop_recipients"("eventId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "price_drop_recipients_eventId_userId_key" ON "price_drop_recipients"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_email_dispatches_eventKey_key" ON "campaign_email_dispatches"("eventKey");

-- CreateIndex
CREATE INDEX "campaign_email_dispatches_userId_status_sentAt_idx" ON "campaign_email_dispatches"("userId", "status", "sentAt");

-- CreateIndex
CREATE INDEX "campaign_email_dispatches_userId_productId_status_idx" ON "campaign_email_dispatches"("userId", "productId", "status");

-- CreateIndex
CREATE INDEX "campaign_email_dispatches_status_createdAt_idx" ON "campaign_email_dispatches"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_drop_events" ADD CONSTRAINT "price_drop_events_historySeq_fkey" FOREIGN KEY ("historySeq") REFERENCES "product_price_history"("seq") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_drop_events" ADD CONSTRAINT "price_drop_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_drop_recipients" ADD CONSTRAINT "price_drop_recipients_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "price_drop_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_drop_recipients" ADD CONSTRAINT "price_drop_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Live status of a discount rule at a given instant. Mirrors deriveRuleStatus in
-- api/domain/effective-price.ts; tests/postgres/price-history.test.ts proves the two agree.
-- Prisma stores DateTime as UTC timestamp without time zone.
CREATE OR REPLACE FUNCTION "hanuja_discount_rule_live_status"(
  "ruleStatus" "DiscountStatus",
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "atTime" TIMESTAMP(3)
) RETURNS TEXT AS $$
BEGIN
  IF "ruleStatus" = 'PAUSED' OR "ruleStatus" = 'EXPIRED' THEN
    RETURN "ruleStatus"::TEXT;
  END IF;
  IF "startsAt" IS NOT NULL AND "startsAt" > "atTime" THEN
    RETURN 'SCHEDULED';
  END IF;
  IF "endsAt" IS NOT NULL AND "endsAt" < "atTime" THEN
    RETURN 'EXPIRED';
  END IF;
  RETURN 'ACTIVE';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- One marker per price-relevant row change. A status flip that does not change the rule's
-- live status (the activation scan's SCHEDULED→ACTIVE / ACTIVE→EXPIRED once the time has come)
-- is not a price change and leaves no marker.
CREATE OR REPLACE FUNCTION "record_price_change_marker"()
RETURNS TRIGGER AS $$
DECLARE
  "atTime" TIMESTAMP(3) := (clock_timestamp() AT TIME ZONE 'UTC');
  "tx" BIGINT := txid_current();
  "pid" TEXT;
  "sid" TEXT;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'DELETE' THEN
      INSERT INTO "price_change_markers" ("entity", "productId", "sellerId", "txId", "changedAt")
      VALUES ('product', OLD."id", OLD."sellerId", "tx", "atTime");
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD."price" IS NOT DISTINCT FROM NEW."price"
      AND OLD."categoryId" IS NOT DISTINCT FROM NEW."categoryId"
      AND OLD."sellerId" IS NOT DISTINCT FROM NEW."sellerId" THEN
      RETURN NEW;
    END IF;
    INSERT INTO "price_change_markers" ("entity", "productId", "sellerId", "txId", "changedAt")
    VALUES ('product', NEW."id", NEW."sellerId", "tx", "atTime");
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'product_variants' THEN
    IF TG_OP = 'DELETE' THEN
      "pid" := OLD."productId";
    ELSE
      "pid" := NEW."productId";
      IF TG_OP = 'UPDATE'
        AND OLD."price" IS NOT DISTINCT FROM NEW."price"
        AND OLD."productId" IS NOT DISTINCT FROM NEW."productId" THEN
        RETURN NEW;
      END IF;
    END IF;
    SELECT "sellerId" INTO "sid" FROM "products" WHERE "id" = "pid";
    INSERT INTO "price_change_markers" ("entity", "productId", "sellerId", "txId", "changedAt")
    VALUES ('variant', "pid", "sid", "tx", "atTime");
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'discount_rules' THEN
    IF TG_OP = 'DELETE' THEN
      INSERT INTO "price_change_markers" ("entity", "sellerId", "ruleId", "txId", "changedAt")
      VALUES ('rule', OLD."sellerId", OLD."id", "tx", "atTime");
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD."scope" IS NOT DISTINCT FROM NEW."scope"
      AND OLD."type" IS NOT DISTINCT FROM NEW."type"
      AND OLD."value" IS NOT DISTINCT FROM NEW."value"
      AND OLD."categoryId" IS NOT DISTINCT FROM NEW."categoryId"
      AND OLD."sellerId" IS NOT DISTINCT FROM NEW."sellerId"
      AND OLD."startsAt" IS NOT DISTINCT FROM NEW."startsAt"
      AND OLD."endsAt" IS NOT DISTINCT FROM NEW."endsAt"
      AND "hanuja_discount_rule_live_status"(OLD."status", OLD."startsAt", OLD."endsAt", "atTime")
        = "hanuja_discount_rule_live_status"(NEW."status", NEW."startsAt", NEW."endsAt", "atTime") THEN
      RETURN NEW;
    END IF;
    INSERT INTO "price_change_markers" ("entity", "sellerId", "ruleId", "txId", "changedAt")
    VALUES ('rule', NEW."sellerId", NEW."id", "tx", "atTime");
    RETURN NEW;
  END IF;

  -- discount_rule_products
  IF TG_OP = 'DELETE' THEN
    SELECT "sellerId" INTO "sid" FROM "discount_rules" WHERE "id" = OLD."discountRuleId";
    INSERT INTO "price_change_markers" ("entity", "productId", "sellerId", "ruleId", "txId", "changedAt")
    VALUES ('rule_product', OLD."productId", "sid", OLD."discountRuleId", "tx", "atTime");
    RETURN OLD;
  END IF;
  SELECT "sellerId" INTO "sid" FROM "discount_rules" WHERE "id" = NEW."discountRuleId";
  INSERT INTO "price_change_markers" ("entity", "productId", "sellerId", "ruleId", "txId", "changedAt")
  VALUES ('rule_product', NEW."productId", "sid", NEW."discountRuleId", "tx", "atTime");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_price_change_marker"
AFTER INSERT OR DELETE OR UPDATE OF "price", "categoryId", "sellerId" ON "products"
FOR EACH ROW EXECUTE FUNCTION "record_price_change_marker"();

CREATE TRIGGER "product_variants_price_change_marker"
AFTER INSERT OR DELETE OR UPDATE OF "price", "productId" ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION "record_price_change_marker"();

CREATE TRIGGER "discount_rules_price_change_marker"
AFTER INSERT OR DELETE OR UPDATE ON "discount_rules"
FOR EACH ROW EXECUTE FUNCTION "record_price_change_marker"();

CREATE TRIGGER "discount_rule_products_price_change_marker"
AFTER INSERT OR DELETE ON "discount_rule_products"
FOR EACH ROW EXECUTE FUNCTION "record_price_change_marker"();
