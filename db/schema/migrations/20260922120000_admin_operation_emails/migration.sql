-- Admin operation e-mails (phase 3).
-- New enum values must be added outside a transaction block in PostgreSQL.
ALTER TYPE "NotificationType" ADD VALUE 'admin_order_cancellation';
ALTER TYPE "NotificationType" ADD VALUE 'admin_return_requested';
ALTER TYPE "NotificationType" ADD VALUE 'admin_seller_application';
ALTER TYPE "AdminActionType" ADD VALUE 'notification_recipient_changed';

-- Operation e-mails go to a configured address, not to a user account.
ALTER TABLE "notification_deliveries" ALTER COLUMN "userId" DROP NOT NULL;

-- A seller application is re-submitted for review; the counter keys the event.
ALTER TABLE "sellers" ADD COLUMN "applicationSubmissionSeq" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "admin_notification_recipients" (
  "event" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "updatedByAdminId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_notification_recipients_pkey" PRIMARY KEY ("event")
);

INSERT INTO "admin_notification_recipients" ("event", "email", "updatedAt") VALUES
  ('order_cancellation', 'admin@hanuja.com.tr', CURRENT_TIMESTAMP),
  ('return_requested',   'admin@hanuja.com.tr', CURRENT_TIMESTAMP),
  ('dispute_opened',     'admin@hanuja.com.tr', CURRENT_TIMESTAMP),
  ('support_ticket',     'admin@hanuja.com.tr', CURRENT_TIMESTAMP),
  ('eft_pending',        'admin@hanuja.com.tr', CURRENT_TIMESTAMP),
  ('fulfillment_risk',   'admin@hanuja.com.tr', CURRENT_TIMESTAMP),
  ('seller_application', 'admin@hanuja.com.tr', CURRENT_TIMESTAMP);

CREATE TABLE "fulfillment_risk_notification_states" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "notifiedStatus" "FulfillmentRiskStatus" NOT NULL,
  "transitionSeq" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 0,
  "lastNotifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fulfillment_risk_notification_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fulfillment_risk_notification_states_orderId_sellerId_key"
  ON "fulfillment_risk_notification_states"("orderId", "sellerId");
CREATE INDEX "fulfillment_risk_notification_states_notifiedStatus_idx"
  ON "fulfillment_risk_notification_states"("notifiedStatus");
