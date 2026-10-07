-- Additive: seller reports do not set delivery confirmation or payout dates.
ALTER TABLE "order_lines"
  ADD COLUMN "sellerDeliveryReportedAt" TIMESTAMP(3),
  ADD COLUMN "sellerDeliveryReportedBy" TEXT;
CREATE INDEX "order_lines_sellerDeliveryReportedAt_idx" ON "order_lines"("sellerDeliveryReportedAt");

ALTER TYPE "AdminActionType" ADD VALUE 'order_admin_note_added';

CREATE TABLE "order_admin_notes" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_admin_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_admin_notes_orderId_createdAt_idx" ON "order_admin_notes"("orderId", "createdAt");
ALTER TABLE "order_admin_notes" ADD CONSTRAINT "order_admin_notes_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_admin_notes" ADD CONSTRAINT "order_admin_notes_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
