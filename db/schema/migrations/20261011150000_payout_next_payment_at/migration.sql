ALTER TABLE "payouts" ADD COLUMN "nextPaymentAt" TIMESTAMP(3);

-- Preserve previously scheduled and settled payouts. A blocked payout must be
-- re-evaluated after its blockers clear before receiving a new payment day.
UPDATE "payouts"
SET "nextPaymentAt" = "holdUntil"
WHERE "status" <> 'payout_blocked';

CREATE INDEX "payouts_nextPaymentAt_status_idx" ON "payouts"("nextPaymentAt", "status");
