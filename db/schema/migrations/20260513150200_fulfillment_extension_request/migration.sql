-- Extension request flow: seller requests extra fulfillment days,
-- admin reviews, optionally consults the customer, and approves/rejects.
-- Customer response captures IP/UA/sessionId for legal evidence.

CREATE TYPE "ExtensionRequestStatus" AS ENUM (
  'pending_admin_review',
  'awaiting_customer_decision',
  'awaiting_seller_followup',
  'approved',
  'rejected_by_admin',
  'rejected_by_customer'
);

-- Add new admin action type for extension decisions (audit logging)
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'extension_request_decision';

CREATE TABLE "fulfillment_extension_requests" (
  "id"                        TEXT NOT NULL,
  "orderId"                   TEXT NOT NULL,
  "sellerId"                  TEXT NOT NULL,
  "customerId"                TEXT NOT NULL,
  "requestedDays"             INTEGER NOT NULL,
  "sellerReason"              TEXT NOT NULL,
  "status"                    "ExtensionRequestStatus" NOT NULL DEFAULT 'pending_admin_review',
  "adminNote"                 TEXT,
  "adminReviewedAt"           TIMESTAMP(3),
  "adminReviewedBy"           TEXT,
  "customerQuestionFromAdmin" TEXT,
  "customerResponseNote"      TEXT,
  "customerRespondedAt"       TIMESTAMP(3),
  "customerResponseIp"        TEXT,
  "customerResponseUserAgent" TEXT,
  "customerResponseSessionId" TEXT,
  "approvedDays"              INTEGER,
  "approvedAt"                TIMESTAMP(3),
  "approvedBy"                TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fulfillment_extension_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fulfillment_extension_requests_orderId_idx"
  ON "fulfillment_extension_requests" ("orderId");

CREATE INDEX "fulfillment_extension_requests_status_createdAt_idx"
  ON "fulfillment_extension_requests" ("status", "createdAt");

CREATE INDEX "fulfillment_extension_requests_sellerId_status_idx"
  ON "fulfillment_extension_requests" ("sellerId", "status");

ALTER TABLE "fulfillment_extension_requests"
  ADD CONSTRAINT "fulfillment_extension_requests_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fulfillment_extension_requests"
  ADD CONSTRAINT "fulfillment_extension_requests_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "sellers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "fulfillment_extension_requests"
  ADD CONSTRAINT "fulfillment_extension_requests_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE;
