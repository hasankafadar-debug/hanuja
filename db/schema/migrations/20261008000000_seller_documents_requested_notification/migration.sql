-- Additive: durable seller document-request e-mails use their own notification type.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_documents_requested';
