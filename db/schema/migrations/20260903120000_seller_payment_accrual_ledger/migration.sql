-- Record seller accruals at payment confirmation and keep refund components auditable.

ALTER TABLE "seller_ledger_entries"
  ADD COLUMN "eventKey" TEXT,
  ADD COLUMN "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "seller_ledger_entries"
SET "effectiveAt" = "createdAt";

CREATE UNIQUE INDEX "seller_ledger_entries_eventKey_key"
  ON "seller_ledger_entries"("eventKey");
CREATE INDEX "seller_ledger_entries_sellerId_effectiveAt_idx"
  ON "seller_ledger_entries"("sellerId", "effectiveAt");
CREATE INDEX "seller_ledger_entries_sellerId_visibleToSeller_effectiveAt_idx"
  ON "seller_ledger_entries"("sellerId", "visibleToSeller", "effectiveAt");

ALTER TABLE "order_cancellations"
  ADD COLUMN "grossProductAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "couponAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "order_cancellation_items"
  ADD COLUMN "grossProductAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "couponAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "return_request_items"
  ADD COLUMN "requestedGrossProductAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "requestedCouponAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "grossProductAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "couponAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "refund_transactions"
  ADD COLUMN "grossProductAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "couponAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "ledgerAppliedAt" TIMESTAMP(3),
  ADD COLUMN "payoutAppliedAt" TIMESTAMP(3);

-- Existing quantity refunds already wrote their ledger effect. A payout adjustment was
-- also applied when a matching payout existed at that time.
UPDATE "refund_transactions"
SET "ledgerAppliedAt" = "accountingAppliedAt"
WHERE "accountingAppliedAt" IS NOT NULL;

UPDATE "refund_transactions" AS refund
SET "payoutAppliedAt" = refund."accountingAppliedAt"
FROM "payouts" AS payout
WHERE refund."accountingAppliedAt" IS NOT NULL
  AND refund."sellerId" IS NOT NULL
  AND payout."orderId" = refund."orderId"
  AND payout."sellerId" = refund."sellerId";

ALTER TABLE "refund_transactions" DROP CONSTRAINT "refund_transactions_amount_check";
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_amount_check"
  CHECK (
    "customerAmount" >= 0 AND "grossProductAmount" >= 0
    AND "couponAdjustmentAmount" >= 0 AND "sellerAdjustmentAmount" >= 0
    AND "commissionAdjustmentAmount" >= 0 AND "platformFundedAmount" >= 0
  );
