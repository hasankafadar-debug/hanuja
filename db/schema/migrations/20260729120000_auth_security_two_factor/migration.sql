-- Additive Better Auth 2FA schema. Existing admins remain in enrollment mode
-- until the rollout flag is enabled; sellers are opted into email OTP below.
ALTER TABLE "users" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "two_factors" (
  "id" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factors_userId_key" ON "two_factors"("userId");
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seller accounts use Better Auth's hashed OTP storage. The two-factor plugin
-- sends the code on each sign-in; no seller TOTP enrollment is required.
UPDATE "users" SET "twoFactorEnabled" = true WHERE "role" = 'seller';

ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'security_step_up_verified';
