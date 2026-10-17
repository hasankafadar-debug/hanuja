-- AlterEnum (yalnız ekleme; önceki migration emsali)
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'card_payment_reconciled';

-- CreateEnum
CREATE TYPE "CardPaymentAttemptStatus" AS ENUM ('initialized', 'threeds_pending', 'authorizing', 'succeeded', 'fraud_review', 'failed', 'outcome_unknown', 'expired', 'voided', 'refunded', 'refunded_by_provider');

-- CreateEnum
CREATE TYPE "CardAttemptReversalKind" AS ENUM ('cancel', 'refund');

-- CreateEnum
CREATE TYPE "CardAttemptReversalStatus" AS ENUM ('pending', 'processing', 'completed', 'uncertain', 'manual_required');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "maxInstallmentCount" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cardPaymentExpiresAt" TIMESTAMP(3),
ADD COLUMN     "customerPaidShippingAmount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "card_payment_quotes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "addressId" TEXT NOT NULL,
    "billingAddressId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "binNumber" TEXT NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "paidPrice" DECIMAL(12,2) NOT NULL,
    "installmentPrice" DECIMAL(12,2) NOT NULL,
    "cardType" TEXT,
    "cardAssociation" TEXT,
    "cardFamily" TEXT,
    "bankName" TEXT,
    "distanceSalesVersion" TEXT NOT NULL,
    "preInformationVersion" TEXT NOT NULL,
    "legalContext" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_payment_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_payment_attempts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "startKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "status" "CardPaymentAttemptStatus" NOT NULL DEFAULT 'initialized',
    "installmentCount" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "paidPrice" DECIMAL(12,2) NOT NULL,
    "installmentDifferenceAmount" DECIMAL(12,2) NOT NULL,
    "binNumber" TEXT NOT NULL,
    "lastFourDigits" TEXT,
    "cardType" TEXT,
    "cardAssociation" TEXT,
    "cardFamily" TEXT,
    "bankName" TEXT,
    "mdStatus" TEXT,
    "fraudStatus" INTEGER,
    "iyziCommissionFee" DECIMAL(12,2),
    "iyziCommissionRateAmount" DECIMAL(12,2),
    "merchantPayoutAmount" DECIMAL(12,2),
    "itemTransactions" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "distanceSalesHtml" TEXT NOT NULL,
    "preInformationHtml" TEXT NOT NULL,
    "distanceSalesVersion" TEXT NOT NULL,
    "preInformationVersion" TEXT NOT NULL,
    "distanceSalesHash" TEXT NOT NULL,
    "preInformationHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedIp" TEXT,
    "acceptedUserAgent" TEXT,
    "acceptedSessionId" TEXT,
    "authRequestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_attempt_reversals" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "kind" "CardAttemptReversalKind" NOT NULL,
    "status" "CardAttemptReversalStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "items" JSONB NOT NULL,
    "providerReference" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_attempt_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iyzico_webhook_events" (
    "id" TEXT NOT NULL,
    "iyziReferenceCode" TEXT NOT NULL,
    "iyziEventType" TEXT NOT NULL,
    "paymentId" TEXT,
    "paymentConversationId" TEXT,
    "status" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "iyzico_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_payment_quotes_userId_createdAt_idx" ON "card_payment_quotes"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "card_payment_quotes_orderId_idx" ON "card_payment_quotes"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "card_payment_attempts_quoteId_key" ON "card_payment_attempts"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "card_payment_attempts_startKey_key" ON "card_payment_attempts"("startKey");

-- CreateIndex
CREATE UNIQUE INDEX "card_payment_attempts_conversationId_key" ON "card_payment_attempts"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "card_payment_attempts_providerPaymentId_key" ON "card_payment_attempts"("providerPaymentId");

-- CreateIndex
CREATE INDEX "card_payment_attempts_status_updatedAt_idx" ON "card_payment_attempts"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "card_payment_attempts_orderId_createdAt_idx" ON "card_payment_attempts"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "card_attempt_reversals_attemptId_key" ON "card_attempt_reversals"("attemptId");

-- CreateIndex
CREATE INDEX "card_attempt_reversals_status_updatedAt_idx" ON "card_attempt_reversals"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "iyzico_webhook_events_iyziReferenceCode_key" ON "iyzico_webhook_events"("iyziReferenceCode");

-- CreateIndex
CREATE INDEX "iyzico_webhook_events_processedAt_receivedAt_idx" ON "iyzico_webhook_events"("processedAt", "receivedAt");

-- AddForeignKey
ALTER TABLE "card_payment_quotes" ADD CONSTRAINT "card_payment_quotes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_payment_quotes" ADD CONSTRAINT "card_payment_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_payment_attempts" ADD CONSTRAINT "card_payment_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_payment_attempts" ADD CONSTRAINT "card_payment_attempts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_payment_attempts" ADD CONSTRAINT "card_payment_attempts_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "card_payment_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_attempt_reversals" ADD CONSTRAINT "card_attempt_reversals_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "card_payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

