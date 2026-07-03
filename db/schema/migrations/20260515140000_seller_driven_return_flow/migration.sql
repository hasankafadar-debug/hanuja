-- Seller-driven return + dispute escalation flow
-- Additive only — no destructive changes, backward compatible with existing rows.

-- AlterTable: seller return-cargo instructions, customer shipment, seller receipt/reject
ALTER TABLE "return_requests"
  ADD COLUMN "sellerReturnAddress"       TEXT,
  ADD COLUMN "sellerReturnCargoCarrier"  TEXT,
  ADD COLUMN "sellerReturnInstructions"  TEXT,
  ADD COLUMN "sellerCargoInfoProvidedAt" TIMESTAMP(3),
  ADD COLUMN "customerShippedAt"         TIMESTAMP(3),
  ADD COLUMN "sellerReceivedAt"          TIMESTAMP(3),
  ADD COLUMN "sellerRejectReason"        TEXT,
  ADD COLUMN "sellerRejectDescription"   TEXT,
  ADD COLUMN "sellerRejectedAt"          TIMESTAMP(3);

-- Return -> escalated Dispute (1-1). disputeId column already exists (orphan); add
-- the unique constraint, index, and foreign key now that it is a real relation.
CREATE UNIQUE INDEX "return_requests_disputeId_key" ON "return_requests"("disputeId");
CREATE INDEX "return_requests_disputeId_idx" ON "return_requests"("disputeId");
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_disputeId_fkey"
  FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: attach media to a specific conversation message
ALTER TABLE "media_assets" ADD COLUMN "returnMessageId" TEXT;
CREATE INDEX "media_assets_returnMessageId_idx" ON "media_assets"("returnMessageId");
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_returnMessageId_fkey"
  FOREIGN KEY ("returnMessageId") REFERENCES "return_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
