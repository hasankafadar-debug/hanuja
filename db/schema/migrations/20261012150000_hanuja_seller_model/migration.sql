ALTER TABLE orders ADD COLUMN "installmentCount" INTEGER, ADD COLUMN "installmentDifferenceAmount" DECIMAL(12,2), ADD COLUMN "installmentTotalAmount" DECIMAL(12,2);
ALTER TABLE order_lines ADD COLUMN "deliveredAt" TIMESTAMP(3);
-- Existing delivery approval is the best available historical receipt evidence.
UPDATE order_lines l SET "deliveredAt" = COALESCE((SELECT MAX(s."deliveredAt") FROM shipment_items si JOIN shipments s ON s.id = si."shipmentId" WHERE si."orderLineId" = l.id), l."deliveryConfirmedAt");
ALTER TABLE return_requests ADD COLUMN "claimType" TEXT NOT NULL DEFAULT 'withdrawal', ADD COLUMN "refundDeadlineAt" TIMESTAMP(3), ADD COLUMN "returnCarrierDeliveredAt" TIMESTAMP(3), ADD COLUMN "predeclaredReturnCarrier" BOOLEAN NOT NULL DEFAULT false;
UPDATE return_requests SET "returnCarrierDeliveredAt" = "sellerReceivedAt", "refundDeadlineAt" = "sellerReceivedAt" + INTERVAL '14 days' WHERE "sellerReceivedAt" IS NOT NULL;
ALTER TABLE return_messages ADD COLUMN audience TEXT;
ALTER TABLE dispute_messages ADD COLUMN audience TEXT;
ALTER TABLE product_question_messages ADD COLUMN audience TEXT;
CREATE INDEX return_requests_refund_deadline_idx ON return_requests ("refundDeadlineAt");

-- Legacy conversations remain staff-only and do not appear as unread to participants.
UPDATE product_question_threads SET "customerLastReadSeq" = "messageSeq", "sellerLastReadSeq" = "messageSeq";
