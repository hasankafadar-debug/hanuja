-- Platform-level configurable business constants
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "standardPenaltyRate" DECIMAL(5,4) NOT NULL DEFAULT 0.2000,
    "fulfillmentDays" INTEGER NOT NULL DEFAULT 20,
    "fulfillmentWarningDays" INTEGER NOT NULL DEFAULT 5,
    "payoutHoldDays" INTEGER NOT NULL DEFAULT 30,
    "freeShippingThresholdTry" DECIMAL(12,2) NOT NULL DEFAULT 1500,
    "flatShippingFeeTry" DECIMAL(12,2) NOT NULL DEFAULT 99,
    "defaultTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.2000,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_settings" ("id")
VALUES ('platform')
ON CONFLICT ("id") DO NOTHING;

-- Category tax rates are nullable so child categories can inherit from parents or the platform default.
ALTER TABLE "categories" ADD COLUMN "taxRate" DECIMAL(5,4);

-- Order VAT snapshot. Amounts are included in product prices, not added on top.
ALTER TABLE "orders" ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "order_lines" ADD COLUMN "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0;
ALTER TABLE "order_lines" ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Persistent fulfillment risk queue for admin follow-up.
CREATE TYPE "FulfillmentRiskStatus" AS ENUM ('warning', 'breached', 'resolved');

CREATE TABLE "fulfillment_risks" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "FulfillmentRiskStatus" NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "warningStartedAt" TIMESTAMP(3),
    "breachedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_risks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fulfillment_risks_orderId_key" ON "fulfillment_risks"("orderId");
CREATE INDEX "fulfillment_risks_sellerId_status_idx" ON "fulfillment_risks"("sellerId", "status");
CREATE INDEX "fulfillment_risks_status_deadlineAt_idx" ON "fulfillment_risks"("status", "deadlineAt");

ALTER TABLE "fulfillment_risks"
ADD CONSTRAINT "fulfillment_risks_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fulfillment_risks"
ADD CONSTRAINT "fulfillment_risks_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
