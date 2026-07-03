-- Add topical-authority metadata to generated blog posts.
ALTER TABLE "blog_posts"
ADD COLUMN "rootTopic" TEXT,
ADD COLUMN "subIntent" TEXT,
ADD COLUMN "intentType" TEXT,
ADD COLUMN "targetKeyword" TEXT,
ADD COLUMN "supportingKeywords" JSONB,
ADD COLUMN "linkedCategoryIds" JSONB,
ADD COLUMN "linkedProductIds" JSONB,
ADD COLUMN "clusterKey" TEXT,
ADD COLUMN "qualityScore" INTEGER,
ADD COLUMN "generationMetadata" JSONB,
ADD COLUMN "generatedBy" TEXT,
ADD COLUMN "generatedAt" TIMESTAMP(3);

-- Anonymous internal-search query log for SEO topic discovery.
CREATE TABLE "site_search_queries" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "categorySlug" TEXT,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_search_queries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "blog_posts_clusterKey_idx" ON "blog_posts"("clusterKey");
CREATE INDEX "blog_posts_rootTopic_intentType_idx" ON "blog_posts"("rootTopic", "intentType");
CREATE INDEX "site_search_queries_normalizedQuery_createdAt_idx" ON "site_search_queries"("normalizedQuery", "createdAt");
CREATE INDEX "site_search_queries_categorySlug_createdAt_idx" ON "site_search_queries"("categorySlug", "createdAt");
