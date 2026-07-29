-- Better Auth 1.6's email OTP verifier requires both twoFactorEnabled=true
-- and a two_factors row. This marker is not a TOTP enrollment and contains no
-- usable authenticator secret or backup codes.
UPDATE "users"
SET "twoFactorEnabled" = true
WHERE "role" = 'seller'
  AND "twoFactorEnabled" = false;

INSERT INTO "two_factors" (
  "id",
  "secret",
  "backupCodes",
  "userId",
  "verified",
  "failedVerificationCount",
  "lockedUntil",
  "createdAt",
  "updatedAt"
)
SELECT
  'seller-email-otp-' || "users"."id",
  'seller-email-otp-only-v1',
  '[]',
  "users"."id",
  false,
  0,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users"
WHERE "users"."role" = 'seller'
  AND NOT EXISTS (
    SELECT 1
    FROM "two_factors"
    WHERE "two_factors"."userId" = "users"."id"
  )
ON CONFLICT ("userId") DO NOTHING;
