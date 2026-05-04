CREATE TABLE "order_seller_invoices" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_seller_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_seller_invoices_orderId_sellerId_key" ON "order_seller_invoices"("orderId", "sellerId");
CREATE INDEX "order_seller_invoices_orderId_idx" ON "order_seller_invoices"("orderId");
CREATE INDEX "order_seller_invoices_sellerId_idx" ON "order_seller_invoices"("sellerId");

ALTER TABLE "order_seller_invoices"
ADD CONSTRAINT "order_seller_invoices_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_seller_invoices"
ADD CONSTRAINT "order_seller_invoices_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
