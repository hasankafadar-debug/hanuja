-- AlterTable
ALTER TABLE "seller_ledger_entries" ADD COLUMN     "visibleToSeller" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "seller_ledger_entries_sellerId_visibleToSeller_createdAt_idx" ON "seller_ledger_entries"("sellerId", "visibleToSeller", "createdAt");
