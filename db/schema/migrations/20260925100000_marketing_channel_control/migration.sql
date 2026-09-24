ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'marketing_channel_updated';
CREATE TABLE "marketing_channel_settings" (
  "id" TEXT NOT NULL DEFAULT 'marketing',
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_channel_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "marketing_channel_settings_singleton" CHECK ("id" = 'marketing')
);
INSERT INTO "marketing_channel_settings" ("id") VALUES ('marketing');
