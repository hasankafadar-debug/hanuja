ALTER TYPE "PayoutStatus" ADD VALUE 'payout_offset';
ALTER TABLE "payouts" ADD COLUMN "offsetAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "settledAt" TIMESTAMP(3);
CREATE TABLE "payout_debt_offsets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "payoutId" TEXT NOT NULL REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ledgerEntryId" TEXT NOT NULL REFERENCES "seller_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "payout_debt_offsets_payoutId_ledgerEntryId_key" ON "payout_debt_offsets"("payoutId", "ledgerEntryId");
CREATE INDEX "payout_debt_offsets_ledgerEntryId_idx" ON "payout_debt_offsets"("ledgerEntryId");
