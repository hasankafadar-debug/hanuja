-- Preserve existing one-box decisions as unverified history. They do not
-- become deliverable channel consent until the IYS process is configured.
CREATE TABLE "marketing_consent_addresses" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "brand" TEXT NOT NULL DEFAULT 'hanuja',
  "channel" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'legacy_unverified',
  "grantedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "verifiedIysAt" TIMESTAMP(3),
  "textVersion" TEXT,
  "source" TEXT,
  "optOutToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_consent_addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_consent_addresses_optOutToken_key"
  ON "marketing_consent_addresses"("optOutToken");
CREATE UNIQUE INDEX "marketing_consent_addresses_userId_brand_channel_address_key"
  ON "marketing_consent_addresses"("userId", "brand", "channel", "address");
CREATE INDEX "marketing_consent_addresses_channel_address_status_idx"
  ON "marketing_consent_addresses"("channel", "address", "status");

CREATE TABLE "marketing_consent_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "brand" TEXT NOT NULL DEFAULT 'hanuja',
  "channel" TEXT NOT NULL,
  "address" TEXT,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "textVersion" TEXT,
  "operationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_consent_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_consent_events_operationId_key"
  ON "marketing_consent_events"("operationId");
CREATE INDEX "marketing_consent_events_userId_channel_createdAt_idx"
  ON "marketing_consent_events"("userId", "channel", "createdAt");

-- Consent evidence is append-only, including for database writes outside the
-- application service. Corrections must be separate events.
CREATE FUNCTION prevent_marketing_consent_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'marketing_consent_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketing_consent_events_immutable
  BEFORE UPDATE OR DELETE ON "marketing_consent_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_marketing_consent_event_change();

INSERT INTO "marketing_consent_addresses"
  ("id", "userId", "brand", "channel", "address", "status", "grantedAt", "revokedAt", "textVersion", "source", "optOutToken", "createdAt", "updatedAt")
SELECT
  md5(c."id" || ':email'), c."userId", 'hanuja', 'email', lower(trim(u."email")),
  CASE WHEN c."emailRevokedAt" IS NULL THEN 'legacy_unverified' ELSE 'revoked' END,
  c."emailConsentAt", c."emailRevokedAt", NULL, c."consentSource",
  md5(c."optOutToken" || ':email'), c."createdAt", c."updatedAt"
FROM "marketing_consents" c
JOIN "users" u ON u."id" = c."userId"
WHERE c."emailConsentAt" IS NOT NULL AND trim(u."email") <> '';
