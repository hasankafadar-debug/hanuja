export const SELLER_EMAIL_OTP_FACTOR_SECRET = "seller-email-otp-only-v1";

type SellerEmailOtpFactorClient = {
  twoFactor: {
    upsert: (args: {
      where: { userId: string };
      update: Record<string, never>;
      create: {
        userId: string;
        secret: string;
        backupCodes: string;
        verified: boolean;
      };
    }) => Promise<unknown>;
  };
};

/**
 * Better Auth 1.6 requires a two-factor row before it will verify an email OTP.
 * The empty update deliberately preserves any existing TOTP enrollment.
 */
export async function ensureSellerEmailOtpFactor(
  client: SellerEmailOtpFactorClient,
  userId: string,
): Promise<void> {
  await client.twoFactor.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      secret: SELLER_EMAIL_OTP_FACTOR_SECRET,
      backupCodes: "[]",
      verified: false,
    },
  });
}
