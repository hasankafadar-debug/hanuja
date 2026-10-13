ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'category_created';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'category_updated';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'catalog_schema_changed';

-- This read-only view also powers the migration dry-run report.
CREATE VIEW product_publication_evidence AS
SELECT "productId", MIN("at") AS "earliestAt", jsonb_agg(jsonb_build_object('source',source,'at',"at")) AS sources
FROM (
  SELECT id AS "productId", "publishedAt" AS "at", 'publishedAt'::text AS source FROM products WHERE "publishedAt" IS NOT NULL
  UNION ALL SELECT l."productId", o."createdAt", 'OrderLine' FROM order_lines l JOIN orders o ON o.id=l."orderId"
  UNION ALL SELECT "productId", "createdAt", 'ProductAnalyticsEvent' FROM product_analytics_events
  UNION ALL SELECT "productId", "createdAt", 'FavoriteProduct' FROM favorite_products
  UNION ALL SELECT "productId", "createdAt", 'CartItem' FROM cart_items
  UNION ALL SELECT "productId", "createdAt", 'ProductReview' FROM product_reviews
  UNION ALL SELECT "productId", "createdAt", 'ProductQuestionThread' FROM product_question_threads WHERE "orderId" IS NULL
  UNION ALL SELECT "targetId", "createdAt", 'product_unlisted' FROM admin_audit_logs WHERE "actionType"='product_unlisted' AND "previousData"->>'status'='published'
) evidence GROUP BY "productId";

CREATE OR REPLACE FUNCTION protect_first_published_at() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE historical TIMESTAMP(3);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."firstPublishedAt" IS NOT NULL
    AND NEW."firstPublishedAt" IS DISTINCT FROM OLD."firstPublishedAt" THEN
    RAISE EXCEPTION 'firstPublishedAt is immutable';
  END IF;
  IF NEW.status = 'published' AND NEW."firstPublishedAt" IS NULL THEN
    IF TG_OP='UPDATE' THEN
      SELECT "earliestAt" INTO historical FROM product_publication_evidence WHERE "productId"=NEW.id;
    END IF;
    NEW."firstPublishedAt" := COALESCE(historical,NEW."publishedAt",CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER products_first_publication BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION protect_first_published_at();
