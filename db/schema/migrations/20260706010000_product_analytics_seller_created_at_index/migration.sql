-- Product analytics reports use real event instants so Istanbul day boundaries
-- remain correct without rewriting historical date-only keys.
CREATE INDEX "product_analytics_events_sellerId_createdAt_idx"
ON "product_analytics_events"("sellerId", "createdAt");
