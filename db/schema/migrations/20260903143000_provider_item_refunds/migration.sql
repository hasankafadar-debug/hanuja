CREATE TYPE "PaymentProvider" AS ENUM ('iyzico', 'manual_eft');
CREATE TYPE "PaymentProviderItemKind" AS ENUM ('product', 'shipping');
CREATE TYPE "RefundTransactionItemStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'manual_required');

ALTER TABLE "payments" ADD COLUMN "provider" "PaymentProvider";
UPDATE "payments"
SET "provider" = CASE
  WHEN "method" = 'card' THEN 'iyzico'::"PaymentProvider"
  ELSE 'manual_eft'::"PaymentProvider"
END;

-- The migration gate runs before the new web release. Keep inserts from the
-- previous application version compatible during that rolling-deploy window:
-- old code does not send provider, so derive it from the immutable method.
CREATE FUNCTION "set_payment_provider_from_method"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."provider" IS NULL THEN
    NEW."provider" := CASE
      WHEN NEW."method" = 'card' THEN 'iyzico'::"PaymentProvider"
      ELSE 'manual_eft'::"PaymentProvider"
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_set_provider_from_method"
BEFORE INSERT ON "payments"
FOR EACH ROW
EXECUTE FUNCTION "set_payment_provider_from_method"();

ALTER TABLE "payments" ALTER COLUMN "provider" SET NOT NULL;

CREATE TABLE "payment_provider_items" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "orderLineId" TEXT,
  "kind" "PaymentProviderItemKind" NOT NULL,
  "providerItemId" TEXT NOT NULL,
  "providerTransactionId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "providerData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_provider_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_provider_items_amount_check" CHECK ("amount" >= 0 AND "refundedAmount" >= 0 AND "refundedAmount" <= "amount")
);

CREATE TABLE "refund_transaction_items" (
  "id" TEXT NOT NULL,
  "refundTransactionId" TEXT NOT NULL,
  "paymentProviderItemId" TEXT,
  "orderLineId" TEXT,
  "kind" "PaymentProviderItemKind" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "quantity" INTEGER,
  "status" "RefundTransactionItemStatus" NOT NULL DEFAULT 'pending',
  "providerReference" TEXT,
  "failureReason" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "refund_transaction_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_transaction_items_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "refund_transaction_items_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0)
);

CREATE UNIQUE INDEX "payment_provider_items_paymentId_providerItemId_key" ON "payment_provider_items"("paymentId", "providerItemId");
CREATE UNIQUE INDEX "payment_provider_items_paymentId_orderLineId_key" ON "payment_provider_items"("paymentId", "orderLineId");
CREATE INDEX "payment_provider_items_providerTransactionId_idx" ON "payment_provider_items"("providerTransactionId");
CREATE UNIQUE INDEX "refund_tx_items_refund_provider_item_key" ON "refund_transaction_items"("refundTransactionId", "paymentProviderItemId");
CREATE UNIQUE INDEX "refund_tx_items_refund_order_line_kind_key" ON "refund_transaction_items"("refundTransactionId", "orderLineId", "kind");
CREATE INDEX "refund_transaction_items_status_createdAt_idx" ON "refund_transaction_items"("status", "createdAt");

ALTER TABLE "payment_provider_items" ADD CONSTRAINT "payment_provider_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_provider_items" ADD CONSTRAINT "payment_provider_items_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_transaction_items" ADD CONSTRAINT "refund_transaction_items_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "refund_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refund_transaction_items" ADD CONSTRAINT "refund_transaction_items_paymentProviderItemId_fkey" FOREIGN KEY ("paymentProviderItemId") REFERENCES "payment_provider_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refund_transaction_items" ADD CONSTRAINT "refund_transaction_items_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing refunds predate basket-item capture. Preserve them as explicit
-- manual-review items; never guess a provider transaction from paymentId.
INSERT INTO "refund_transaction_items" (
  "id", "refundTransactionId", "kind", "amount", "status",
  "providerReference", "failureReason", "attemptCount", "completedAt",
  "createdAt", "updatedAt"
)
SELECT
  'legacy-' || rt."id",
  rt."id",
  'product'::"PaymentProviderItemKind",
  rt."customerAmount",
  CASE
    WHEN rt."status" = 'completed' THEN 'completed'::"RefundTransactionItemStatus"
    ELSE 'manual_required'::"RefundTransactionItemStatus"
  END,
  rt."providerReference",
  CASE
    WHEN rt."status" = 'completed' THEN NULL
    ELSE 'Eski iade kaydında sağlayıcı kalem işlem ID’si yok; manuel müdahale gerekli'
  END,
  0,
  rt."completedAt",
  rt."createdAt",
  rt."updatedAt"
FROM "refund_transactions" rt
WHERE rt."customerAmount" > 0;

UPDATE "refund_transactions"
SET
  "status" = 'manual_required',
  "failureReason" = COALESCE(
    "failureReason",
    'Eski iade kaydında sağlayıcı kalem işlem ID’si yok; manuel müdahale gerekli'
  )
WHERE "status" <> 'completed';
