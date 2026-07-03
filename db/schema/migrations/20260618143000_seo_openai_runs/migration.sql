ALTER TYPE "AdminActionType" ADD VALUE 'seo_content_run_triggered';

CREATE TABLE "seo_content_runs" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "budgetSnapshot" JSONB,
    "totals" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_content_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_content_generations" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "clusterKey" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL,
    "candidateSnapshot" JSONB NOT NULL,
    "factPackHash" TEXT,
    "promptVersion" TEXT,
    "schemaVersion" TEXT,
    "promptHash" TEXT,
    "openaiResponseId" TEXT,
    "openaiImageResponseId" TEXT,
    "tokenUsage" JSONB,
    "estimatedCostUsd" DOUBLE PRECISION,
    "imageAssetId" TEXT,
    "imageObjectKey" TEXT,
    "gateResults" JSONB,
    "errors" JSONB,
    "blogPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_content_generations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seo_content_generations_idempotencyKey_key" ON "seo_content_generations"("idempotencyKey");
CREATE INDEX "seo_content_runs_status_startedAt_idx" ON "seo_content_runs"("status", "startedAt");
CREATE INDEX "seo_content_runs_mode_createdAt_idx" ON "seo_content_runs"("mode", "createdAt");
CREATE INDEX "seo_content_generations_runId_status_idx" ON "seo_content_generations"("runId", "status");
CREATE INDEX "seo_content_generations_clusterKey_createdAt_idx" ON "seo_content_generations"("clusterKey", "createdAt");

ALTER TABLE "seo_content_generations"
ADD CONSTRAINT "seo_content_generations_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "seo_content_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
