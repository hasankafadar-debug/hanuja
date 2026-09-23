-- Product questions (e-mail plan phase 4): private customer <-> seller conversations.
-- New enum values must be added outside a transaction block in PostgreSQL; IF NOT EXISTS keeps
-- a re-application harmless.
-- CreateEnum
CREATE TYPE "ProductQuestionStatus" AS ENUM ('waiting_for_seller', 'waiting_for_customer');

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'product_question_viewed';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_product_question';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'customer_product_question_answered';

-- CreateTable
CREATE TABLE "product_question_threads" (
    "id" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" "ProductQuestionStatus" NOT NULL DEFAULT 'waiting_for_seller',
    "turnSeq" INTEGER NOT NULL DEFAULT 1,
    "messageSeq" INTEGER NOT NULL DEFAULT 0,
    "lastCustomerMessageSeq" INTEGER NOT NULL DEFAULT 0,
    "lastSellerMessageSeq" INTEGER NOT NULL DEFAULT 0,
    "customerLastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "sellerLastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_question_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_question_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "UserRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_question_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_question_threads_threadKey_key" ON "product_question_threads"("threadKey");

-- CreateIndex
CREATE INDEX "product_question_threads_sellerId_status_lastMessageAt_idx" ON "product_question_threads"("sellerId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "product_question_threads_customerId_lastMessageAt_idx" ON "product_question_threads"("customerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "product_question_threads_productId_idx" ON "product_question_threads"("productId");

-- CreateIndex
CREATE INDEX "product_question_threads_orderId_idx" ON "product_question_threads"("orderId");

-- CreateIndex
CREATE INDEX "product_question_messages_authorId_idx" ON "product_question_messages"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "product_question_messages_threadId_seq_key" ON "product_question_messages"("threadId", "seq");

-- AddForeignKey
ALTER TABLE "product_question_threads" ADD CONSTRAINT "product_question_threads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_question_threads" ADD CONSTRAINT "product_question_threads_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_question_threads" ADD CONSTRAINT "product_question_threads_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_question_threads" ADD CONSTRAINT "product_question_threads_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_question_messages" ADD CONSTRAINT "product_question_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "product_question_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_question_messages" ADD CONSTRAINT "product_question_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

