-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "selectedBankAccountId" TEXT;

-- CreateTable
CREATE TABLE "platform_bank_accounts" (
    "id" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountHolderNote" TEXT,
    "bankName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "branchName" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_bank_accounts_iban_key" ON "platform_bank_accounts"("iban");

-- CreateIndex
CREATE INDEX "platform_bank_accounts_isActive_displayOrder_idx" ON "platform_bank_accounts"("isActive", "displayOrder");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_selectedBankAccountId_fkey" FOREIGN KEY ("selectedBankAccountId") REFERENCES "platform_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
