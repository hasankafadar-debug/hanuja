ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'invoice_uploaded';

ALTER TABLE "order_seller_invoices"
ADD COLUMN IF NOT EXISTS "inboundEmailId" TEXT,
ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS "order_email_aliases" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "aliasEmail" TEXT NOT NULL,
  "localPart" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'invoice',
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastInboundAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_email_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inbound_emails" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "orderId" TEXT,
  "sellerId" TEXT,
  "aliasEmail" TEXT NOT NULL,
  "fromEmail" TEXT,
  "subject" TEXT,
  "status" TEXT NOT NULL,
  "selectedAttachment" JSONB,
  "errorReason" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_email_aliases_aliasEmail_key" ON "order_email_aliases"("aliasEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "order_email_aliases_localPart_key" ON "order_email_aliases"("localPart");
CREATE UNIQUE INDEX IF NOT EXISTS "order_email_aliases_orderId_sellerId_purpose_key" ON "order_email_aliases"("orderId", "sellerId", "purpose");
CREATE INDEX IF NOT EXISTS "order_email_aliases_sellerId_status_idx" ON "order_email_aliases"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "order_email_aliases_orderId_idx" ON "order_email_aliases"("orderId");

CREATE UNIQUE INDEX IF NOT EXISTS "inbound_emails_messageId_key" ON "inbound_emails"("messageId");
CREATE INDEX IF NOT EXISTS "inbound_emails_aliasEmail_idx" ON "inbound_emails"("aliasEmail");
CREATE INDEX IF NOT EXISTS "inbound_emails_orderId_idx" ON "inbound_emails"("orderId");
CREATE INDEX IF NOT EXISTS "inbound_emails_status_idx" ON "inbound_emails"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "order_seller_invoices_inboundEmailId_key" ON "order_seller_invoices"("inboundEmailId");
CREATE INDEX IF NOT EXISTS "order_seller_invoices_source_idx" ON "order_seller_invoices"("source");

DO $$ BEGIN
  ALTER TABLE "order_email_aliases"
  ADD CONSTRAINT "order_email_aliases_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_email_aliases"
  ADD CONSTRAINT "order_email_aliases_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "inbound_emails"
  ADD CONSTRAINT "inbound_emails_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_seller_invoices"
  ADD CONSTRAINT "order_seller_invoices_inboundEmailId_fkey"
  FOREIGN KEY ("inboundEmailId") REFERENCES "inbound_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
