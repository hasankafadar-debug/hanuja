-- Havale/EFT sipariş isteği tekrar koruması (yalnız ekleme).
-- Mevcut siparişlerde üç alan da NULL kalır; PostgreSQL tekil indekste NULL'ları ayrı sayar.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "checkoutRequestKey" TEXT,
ADD COLUMN     "checkoutRequestHash" TEXT,
ADD COLUMN     "checkoutCartHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_customerId_checkoutRequestKey_key" ON "orders"("customerId", "checkoutRequestKey");
