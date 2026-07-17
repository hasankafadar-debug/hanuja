-- Favori/sepet indirim kampanya e-postaları için rıza + dispatch modeli (additive).
--
-- MarketingConsent: tek bir kayıt onayı (signup checkbox) hem email hem sms rızasını
-- aynı anda set eder (iş kararı). Kanallar ileride ayrışabilir diye ayrı tutulur.
-- CampaignEmailDispatch: favori/sepetteki üründe indirim başladığında kullanıcı
-- başına idempotent e-posta gönderim kaydı (fingerprint + kaynak bazlı dedupe).
--
-- Bu migration yalnızca veri modelini ekler; queue/job/route/template kablolaması
-- sonraki fazda gelir.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'product_discount_favorited';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'product_discount_in_cart';

CREATE TYPE "CampaignDispatchSource" AS ENUM ('favorite', 'cart');

CREATE INDEX "cart_items_productId_idx"
  ON "cart_items" ("productId");

CREATE TABLE "marketing_consents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emailConsentAt" TIMESTAMP(3),
  "emailRevokedAt" TIMESTAMP(3),
  "smsConsentAt" TIMESTAMP(3),
  "smsRevokedAt" TIMESTAMP(3),
  "consentSource" TEXT NOT NULL,
  "optOutToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "marketing_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_consents_userId_key"
  ON "marketing_consents" ("userId");

CREATE UNIQUE INDEX "marketing_consents_optOutToken_key"
  ON "marketing_consents" ("optOutToken");

ALTER TABLE "marketing_consents"
  ADD CONSTRAINT "marketing_consents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "campaign_email_dispatches" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "discountRuleId" TEXT,
  "productId" TEXT,
  "discountFingerprint" TEXT NOT NULL,
  "source" "CampaignDispatchSource" NOT NULL,
  "emailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "campaign_email_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_email_dispatches_userId_discountFingerprint_source_key"
  ON "campaign_email_dispatches" ("userId", "discountFingerprint", "source");

CREATE INDEX "campaign_email_dispatches_discountRuleId_idx"
  ON "campaign_email_dispatches" ("discountRuleId");

-- Per-user/product kampanya e-postası cooldown taraması (fingerprint'ten bağımsız).
CREATE INDEX "campaign_email_dispatches_userId_productId_createdAt_idx"
  ON "campaign_email_dispatches" ("userId", "productId", "createdAt");

ALTER TABLE "campaign_email_dispatches"
  ADD CONSTRAINT "campaign_email_dispatches_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
