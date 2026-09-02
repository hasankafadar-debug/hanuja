-- Quantity-aware cancellation/return lifecycle for new (v2) orders.
-- Existing orders remain lifecycle version 1 and keep the legacy behavior.

CREATE TYPE "SellerFulfillmentStatus" AS ENUM (
  'queue_ready', 'reviewing', 'accepted', 'preparing', 'awaiting_shipment',
  'shipped', 'delivered', 'delivery_confirmation_pending', 'delivery_confirmed', 'cancelled'
);
CREATE TYPE "OrderCancellationStatus" AS ENUM ('refund_pending', 'completed', 'refund_failed');
CREATE TYPE "RefundTransactionStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE "RefundSourceType" AS ENUM ('cancellation', 'return_request', 'dispute');

ALTER TABLE "orders"
  ADD COLUMN "quantityLifecycleVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "refundedShippingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "order_lines"
  ADD COLUMN "cancelledQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shippedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "returnClaimedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "customerPaidProductAmount" DECIMAL(12,2);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quantity_lifecycle_check"
  CHECK (
    "cancelledQuantity" >= 0 AND "shippedQuantity" >= 0 AND "returnClaimedQuantity" >= 0
    AND "cancelledQuantity" + "shippedQuantity" <= "quantity"
    AND "returnClaimedQuantity" <= "shippedQuantity"
  );

ALTER TABLE "payments"
  ADD COLUMN "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "return_requests"
  ADD COLUMN "sellerId" TEXT,
  ADD COLUMN "requestKey" TEXT;

CREATE INDEX "return_requests_sellerId_status_idx" ON "return_requests"("sellerId", "status");
CREATE UNIQUE INDEX "return_requests_orderId_customerId_requestKey_sellerId_key"
  ON "return_requests"("orderId", "customerId", "requestKey", "sellerId");
DROP INDEX "shipments_orderId_idx";
CREATE UNIQUE INDEX "shipments_orderId_sellerId_key" ON "shipments"("orderId", "sellerId");

CREATE TABLE "order_seller_fulfillments" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "status" "SellerFulfillmentStatus" NOT NULL DEFAULT 'queue_ready',
  "acceptedAt" TIMESTAMP(3),
  "preparingAt" TIMESTAMP(3),
  "awaitingShipmentAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "deliveryConfirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_seller_fulfillments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_seller_fulfillments_orderId_sellerId_key" ON "order_seller_fulfillments"("orderId", "sellerId");
CREATE INDEX "order_seller_fulfillments_sellerId_status_idx" ON "order_seller_fulfillments"("sellerId", "status");
ALTER TABLE "order_seller_fulfillments" ADD CONSTRAINT "order_seller_fulfillments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_seller_fulfillments" ADD CONSTRAINT "order_seller_fulfillments_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shipment_items" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_quantity_check" CHECK ("quantity" > 0);
CREATE UNIQUE INDEX "shipment_items_shipmentId_orderLineId_key" ON "shipment_items"("shipmentId", "orderLineId");
CREATE INDEX "shipment_items_orderLineId_idx" ON "shipment_items"("orderLineId");
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "order_cancellations" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "requestKey" TEXT,
  "reason" TEXT NOT NULL,
  "status" "OrderCancellationStatus" NOT NULL DEFAULT 'refund_pending',
  "customerRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sellerAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commissionAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "shippingRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_cancellations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_cancellations_orderId_createdAt_idx" ON "order_cancellations"("orderId", "createdAt");
CREATE INDEX "order_cancellations_sellerId_status_idx" ON "order_cancellations"("sellerId", "status");
CREATE UNIQUE INDEX "order_cancellations_orderId_customerId_requestKey_sellerId_key"
  ON "order_cancellations"("orderId", "customerId", "requestKey", "sellerId");
ALTER TABLE "order_cancellations" ADD CONSTRAINT "order_cancellations_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "order_cancellation_items" (
  "id" TEXT NOT NULL,
  "cancellationId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "customerRefundAmount" DECIMAL(12,2) NOT NULL,
  "sellerAdjustmentAmount" DECIMAL(12,2) NOT NULL,
  "commissionAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_cancellation_items_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "order_cancellation_items" ADD CONSTRAINT "order_cancellation_items_quantity_check" CHECK ("quantity" > 0);
CREATE UNIQUE INDEX "order_cancellation_items_cancellationId_orderLineId_key" ON "order_cancellation_items"("cancellationId", "orderLineId");
CREATE INDEX "order_cancellation_items_orderLineId_idx" ON "order_cancellation_items"("orderLineId");
ALTER TABLE "order_cancellation_items" ADD CONSTRAINT "order_cancellation_items_cancellationId_fkey"
  FOREIGN KEY ("cancellationId") REFERENCES "order_cancellations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_cancellation_items" ADD CONSTRAINT "order_cancellation_items_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "return_request_items" (
  "id" TEXT NOT NULL,
  "returnRequestId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "requestedQuantity" INTEGER NOT NULL,
  "acceptedQuantity" INTEGER NOT NULL DEFAULT 0,
  "rejectedQuantity" INTEGER NOT NULL DEFAULT 0,
  "rejectionReason" TEXT,
  "requestedCustomerAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "requestedSellerAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "requestedCommissionAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "customerRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sellerAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commissionAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "return_request_items_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "return_request_items" ADD CONSTRAINT "return_request_items_quantity_check"
  CHECK (
    "requestedQuantity" > 0 AND "acceptedQuantity" >= 0 AND "rejectedQuantity" >= 0
    AND "acceptedQuantity" + "rejectedQuantity" <= "requestedQuantity"
  );
CREATE UNIQUE INDEX "return_request_items_returnRequestId_orderLineId_key" ON "return_request_items"("returnRequestId", "orderLineId");
CREATE INDEX "return_request_items_orderLineId_idx" ON "return_request_items"("orderLineId");
ALTER TABLE "return_request_items" ADD CONSTRAINT "return_request_items_returnRequestId_fkey"
  FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "return_request_items" ADD CONSTRAINT "return_request_items_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "refund_transactions" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT,
  "sellerId" TEXT,
  "sourceType" "RefundSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "customerAmount" DECIMAL(12,2) NOT NULL,
  "sellerAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commissionAdjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "platformFundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "RefundTransactionStatus" NOT NULL DEFAULT 'pending',
  "providerReference" TEXT,
  "failureReason" TEXT,
  "accountingAppliedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "refund_transactions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_amount_check"
  CHECK (
    "customerAmount" >= 0 AND "sellerAdjustmentAmount" >= 0
    AND "commissionAdjustmentAmount" >= 0 AND "platformFundedAmount" >= 0
  );
CREATE UNIQUE INDEX "refund_transactions_sourceType_sourceId_key" ON "refund_transactions"("sourceType", "sourceId");
CREATE INDEX "refund_transactions_status_createdAt_idx" ON "refund_transactions"("status", "createdAt");
CREATE INDEX "refund_transactions_orderId_sellerId_idx" ON "refund_transactions"("orderId", "sellerId");
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
