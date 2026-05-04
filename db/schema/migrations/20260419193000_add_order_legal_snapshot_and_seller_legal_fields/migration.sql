-- AlterTable
ALTER TABLE "seller_profiles"
ADD COLUMN "companyName" TEXT,
ADD COLUMN "district" TEXT,
ADD COLUMN "postalCode" TEXT,
ADD COLUMN "legalAddress" TEXT,
ADD COLUMN "taxOffice" TEXT,
ADD COLUMN "mersis" TEXT;

-- CreateTable
CREATE TABLE "order_legal_snapshots" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "distanceSalesHtml" TEXT NOT NULL,
    "preInformationHtml" TEXT NOT NULL,
    "buyerSnapshot" JSONB NOT NULL,
    "sellerSnapshot" JSONB NOT NULL,
    "platformSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_legal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_legal_snapshots_orderId_key" ON "order_legal_snapshots"("orderId");

-- AddForeignKey
ALTER TABLE "order_legal_snapshots"
ADD CONSTRAINT "order_legal_snapshots_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
