ALTER TABLE "users"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sellers"
ADD COLUMN "documentsRequestedAt" TIMESTAMP(3),
ADD COLUMN "requiredDocumentTypes" JSONB;

ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_documents_requested';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'seller_password_reset_by_admin';
