ALTER TYPE "CardPaymentAttemptStatus" ADD VALUE 'checkout_form_pending';
ALTER TABLE "card_payment_attempts"
  ALTER COLUMN "quoteId" DROP NOT NULL,
  ALTER COLUMN "installmentCount" DROP NOT NULL,
  ALTER COLUMN "paidPrice" DROP NOT NULL,
  ALTER COLUMN "installmentDifferenceAmount" DROP NOT NULL,
  ALTER COLUMN "binNumber" DROP NOT NULL,
  ADD COLUMN "flow" TEXT NOT NULL DEFAULT 'direct_3ds',
  ADD COLUMN "checkoutFormToken" TEXT,
  ADD COLUMN "checkoutFormUrl" TEXT,
  ADD COLUMN "checkoutFormExpiresAt" TIMESTAMP(3),
  ADD COLUMN "allowedInstallments" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "legalContext" JSONB,
  ADD COLUMN "sourceHash" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "card_payment_attempts_checkoutFormToken_key" ON "card_payment_attempts"("checkoutFormToken");
ALTER TABLE "iyzico_webhook_events" ADD COLUMN "checkoutFormToken" TEXT;
ALTER TABLE "card_payment_attempts" ADD COLUMN "checkoutFormPreviewId" TEXT;
CREATE UNIQUE INDEX "card_payment_attempts_checkoutFormPreviewId_key" ON "card_payment_attempts"("checkoutFormPreviewId");
CREATE TABLE "checkout_form_previews" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "orderId" TEXT,
  "addressId" TEXT NOT NULL,
  "billingAddressId" TEXT,
  "sourceHash" TEXT NOT NULL,
  "legalContext" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "checkout_form_previews_expiresAt_idx" ON "checkout_form_previews"("expiresAt");
