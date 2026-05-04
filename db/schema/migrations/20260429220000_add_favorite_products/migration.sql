CREATE TABLE "favorite_products" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "favorite_products_userId_productId_key" ON "favorite_products"("userId", "productId");
CREATE INDEX "favorite_products_userId_createdAt_idx" ON "favorite_products"("userId", "createdAt");
CREATE INDEX "favorite_products_productId_idx" ON "favorite_products"("productId");

ALTER TABLE "favorite_products"
ADD CONSTRAINT "favorite_products_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "favorite_products"
ADD CONSTRAINT "favorite_products_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
