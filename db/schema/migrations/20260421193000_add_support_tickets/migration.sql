CREATE TYPE "SupportTicketStatus" AS ENUM (
  'waiting_for_admin',
  'waiting_for_seller',
  'resolved'
);

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'seller_support_reply';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'admin_support_new_ticket';

CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "orderId" TEXT,
  "subject" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'waiting_for_admin',
  "resolvedAt" TIMESTAMP(3),
  "lastSellerMessageAt" TIMESTAMP(3),
  "lastAdminMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_messages" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorRole" "UserRole" NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_sellerId_status_updatedAt_idx"
ON "support_tickets"("sellerId", "status", "updatedAt");

CREATE INDEX "support_tickets_orderId_idx"
ON "support_tickets"("orderId");

CREATE INDEX "support_tickets_status_updatedAt_idx"
ON "support_tickets"("status", "updatedAt");

CREATE INDEX "support_messages_ticketId_createdAt_idx"
ON "support_messages"("ticketId", "createdAt");

CREATE INDEX "support_messages_authorId_idx"
ON "support_messages"("authorId");

ALTER TABLE "support_tickets"
ADD CONSTRAINT "support_tickets_sellerId_fkey"
FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
ADD CONSTRAINT "support_tickets_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_messages"
ADD CONSTRAINT "support_messages_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_messages"
ADD CONSTRAINT "support_messages_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
