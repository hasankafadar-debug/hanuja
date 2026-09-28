-- Additive: append-only proof of storefront cookie consent decisions.
-- No IP address or user agent is stored (docs/08-legal/cookie-policy-notes.md).
CREATE TYPE "CookieConsentAction" AS ENUM ('accept_all', 'reject_all', 'custom', 'withdraw');

CREATE TABLE "cookie_consent_records" (
  "id" TEXT NOT NULL,
  "consentId" TEXT NOT NULL,
  "userId" TEXT,
  "policyVersion" TEXT NOT NULL,
  "necessary" BOOLEAN NOT NULL DEFAULT true,
  "functional" BOOLEAN NOT NULL,
  "analytics" BOOLEAN NOT NULL,
  "marketing" BOOLEAN NOT NULL,
  "action" "CookieConsentAction" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cookie_consent_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cookie_consent_records_consentId_createdAt_idx" ON "cookie_consent_records"("consentId", "createdAt");
CREATE INDEX "cookie_consent_records_userId_idx" ON "cookie_consent_records"("userId");

ALTER TABLE "cookie_consent_records" ADD CONSTRAINT "cookie_consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
