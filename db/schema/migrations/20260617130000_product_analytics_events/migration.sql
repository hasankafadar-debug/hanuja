-- CreateEnum
CREATE TYPE "ProductAnalyticsEventType" AS ENUM ('product_view', 'cart_add', 'favorite_add');

-- CreateTable
CREATE TABLE "product_analytics_events" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "ProductAnalyticsEventType" NOT NULL,
    "eventDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_analytics_events_productId_userId_eventType_eventDate_key" ON "product_analytics_events"("productId", "userId", "eventType", "eventDate");

-- CreateIndex
CREATE INDEX "product_analytics_events_sellerId_eventType_eventDate_idx" ON "product_analytics_events"("sellerId", "eventType", "eventDate");

-- CreateIndex
CREATE INDEX "product_analytics_events_productId_eventType_eventDate_idx" ON "product_analytics_events"("productId", "eventType", "eventDate");

-- AddForeignKey
ALTER TABLE "product_analytics_events" ADD CONSTRAINT "product_analytics_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analytics_events" ADD CONSTRAINT "product_analytics_events_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analytics_events" ADD CONSTRAINT "product_analytics_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
