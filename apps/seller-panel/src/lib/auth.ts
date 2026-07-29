/**
 * Better Auth server instance — seller panel (apps/seller-panel).
 *
 * Self-contained: does not import from api/ to avoid Next.js build path issues.
 * Seller access is enforced by middleware (role === 'seller' required).
 */
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin as adminPlugin, captcha, twoFactor } from "better-auth/plugins";
import { PrismaClient } from "@prisma/client";
import { sendEmail } from "@hanuja/api/lib/mailer";
import { emailVerificationTemplate } from "@hanuja/api/lib/email-templates/email-verification";
import { sellerPasswordResetTemplate } from "@hanuja/api/lib/email-templates/seller-password-reset";
import { evaluateAuthPasswordPolicy } from "@hanuja/security/password-policy";
import { getRedis } from "@hanuja/api/lib/redis";
import { revokeTrustedDevices } from "@hanuja/api/lib/auth-security";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";

function expandTrustedOriginVariants(
  urls: Array<string | undefined>,
): string[] {
  const origins = new Set<string>();

  for (const value of urls) {
    if (!value) continue;

    try {
      const url = new URL(value);
      origins.add(url.origin);

      if (process.env.NODE_ENV === "development") {
        if (url.hostname === "localhost") {
          origins.add(`${url.protocol}//127.0.0.1:${url.port}`);
        }

        if (url.hostname === "127.0.0.1") {
          origins.add(`${url.protocol}//localhost:${url.port}`);
        }
      }
    } catch {
      // Ignore malformed optional env values and keep explicit defaults working.
    }
  }

  return Array.from(origins);
}

const _auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? "change-me-in-production",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  // Retire existing persistent cookies. New seller logins are explicitly
  // session-only via rememberMe: false in the login form.
  advanced: { cookiePrefix: "hanuja-seller-session-v2" },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: { "/change-password": { window: 60, max: 5 } },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Resolve the short-lived Better Auth challenge server-side. An admin
      // using the seller panel must complete TOTP; never let that role select
      // the seller email OTP endpoint.
      if (
        ctx.path === "/two-factor/send-otp" ||
        ctx.path === "/two-factor/verify-otp"
      ) {
        const challengeCookie = ctx.context.createAuthCookie("two_factor", {
          maxAge: 10 * 60,
        });
        const identifier = await ctx.getSignedCookie(
          challengeCookie.name,
          ctx.context.secret,
        );
        const challenge = identifier
          ? await ctx.context.internalAdapter.findVerificationValue(identifier)
          : null;
        const user = challenge
          ? await ctx.context.internalAdapter.findUserById(challenge.value)
          : null;
        if ((user as { role?: string } | null)?.role === "admin") {
          throw new APIError("FORBIDDEN", {
            message: "Admin hesaplari e-posta OTP kullanamaz.",
          });
        }
        if (ctx.path === "/two-factor/send-otp" && user?.id) {
          // Redis is deliberately authoritative here. Any Redis outage rejects
          // the send rather than silently weakening a credential flow.
          const redis = getRedis();
          const resendKey = `auth:seller-otp:resend:${user.id}`;
          if ((await redis.set(resendKey, "1", "EX", 60, "NX")) !== "OK") {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Kod yeniden gonderimi icin 60 saniye bekleyin.",
            });
          }
          const hourlyKey = `auth:seller-otp:hour:${user.id}`;
          const hourlyCount = await redis.incr(hourlyKey);
          if (hourlyCount === 1) await redis.expire(hourlyKey, 60 * 60);
          if (hourlyCount > 3) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Saatlik kod gonderim limitine ulastiniz.",
            });
          }
        }
      }
      const message = evaluateAuthPasswordPolicy(ctx.path, ctx.body, "seller");
      if (message) {
        throw new APIError("BAD_REQUEST", { message });
      }
    }),
  },
  plugins: [
    captcha({
      provider: "cloudflare-turnstile",
      secretKey:
        process.env.TURNSTILE_SECRET_KEY ?? "turnstile-secret-not-configured",
      endpoints: ["/sign-in/email"],
    }),
    // OTP records are stored hashed by Better Auth. Seller accounts only use
    // email OTP; the TOTP provider is disabled for this panel.
    twoFactor({
      issuer: "Hanuja Satici",
      totpOptions: { disable: true },
      otpOptions: {
        digits: 6,
        period: 10,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendOTP: async ({ user, otp }) => {
          await sendEmail({
            to: user.email,
            subject: "Hanuja satici giris kodunuz",
            text: `Giris kodunuz: ${otp}. Kod 10 dakika gecerlidir.`,
            html: `<p>Giris kodunuz: <strong>${otp}</strong></p><p>Kod 10 dakika gecerlidir.</p>`,
          });
        },
      },
      backupCodeOptions: { amount: 10 },
      accountLockout: { enabled: false },
      trustDeviceMaxAge: 60 * 60 * 24 * 400,
    }),
    adminPlugin({ defaultRole: "customer", adminRoles: ["admin"] }),
  ],
  trustedOrigins: expandTrustedOriginVariants([
    baseURL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.SELLER_PANEL_URL,
    process.env.ADMIN_PANEL_URL,
  ]),
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "customer", input: false },
      phone: { type: "string", required: false, input: true },
      mustChangePassword: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      const template = sellerPasswordResetTemplate({
        email: user.email,
        resetUrl: url,
      });
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
    },
    onPasswordReset: async ({ user }) => {
      await revokeTrustedDevices(prisma, user.id);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const template = emailVerificationTemplate({
        email: user.email,
        verificationUrl: url,
      });

      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
    },
  },
}) as unknown as {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (opts: { headers: Headers }) => Promise<{
      user: {
        id: string;
        email: string;
        emailVerified: boolean;
        role: string;
        mustChangePassword?: boolean;
        phone?: string;
      };
    } | null>;
    setPassword: (opts: {
      headers: Headers;
      body: { newPassword: string };
    }) => Promise<unknown>;
    changePassword: (opts: {
      headers: Headers;
      body: {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions: boolean;
      };
    }) => Promise<unknown>;
    requestPasswordReset: (opts: {
      body: { email: string; redirectTo?: string };
    }) => Promise<unknown>;
    resetPassword: (opts: {
      body: { newPassword: string; token?: string };
    }) => Promise<unknown>;
    sendVerificationEmail: (opts: {
      body: { callbackURL?: string; email: string };
    }) => Promise<unknown>;
    admin: {
      setUserPassword: (opts: {
        headers: Headers;
        body: { userId: string; newPassword: string };
      }) => Promise<unknown>;
    };
  };
};

export const auth = _auth;
export const authHandler: (request: Request) => Promise<Response> =
  _auth.handler;
