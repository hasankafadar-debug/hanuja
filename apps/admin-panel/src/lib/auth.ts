/**
 * Better Auth server instance — admin panel (apps/admin-panel).
 *
 * Self-contained: does not import from api/ to avoid Next.js build path issues.
 * Only admin-role users are permitted access (enforced in middleware.ts).
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin as adminPlugin, captcha, twoFactor } from "better-auth/plugins";
import { PrismaClient } from "@prisma/client";
import { sendEmail } from "@hanuja/api/lib/mailer";
import { passwordResetTemplate } from "@hanuja/api/lib/email-templates/password-reset";
import { passwordChangedTemplate } from "@hanuja/api/lib/email-templates/password-changed";
import { revokeTrustedDevices } from "@hanuja/api/lib/auth-security";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3002";

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

async function ensureDatabaseConnection(
  request: Request,
): Promise<Response | null> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("[admin-auth] Database readiness check failed.", {
      url: request.url,
      message,
    });

    return Response.json(
      {
        code: "DATABASE_UNAVAILABLE",
        message:
          process.env.NODE_ENV === "development"
            ? "Admin paneli veritabanina baglanamadi. apps/admin-panel/.env.local icindeki DATABASE_URL ayarini kontrol edin."
            : "Admin paneli veritabanina baglanamadi.",
      },
      { status: 503 },
    );
  }
}

// Cast to avoid TypeScript "cannot be named" error caused by zod internal path references
const _auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? "change-me-in-production",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      const template = passwordResetTemplate({ resetUrl: url });
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
    },
    onPasswordReset: async ({ user }) => {
      await revokeTrustedDevices(prisma, user.id);
      const template = passwordChangedTemplate({ changedAt: new Date() });
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }).catch(console.error);
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  // A new prefix immediately retires the old 30-day admin cookies. New admin
  // sign-ins use rememberMe: false and therefore create browser-session-only
  // cookies.
  advanced: { cookiePrefix: "hanuja-admin-session-v2" },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: { "/change-password": { window: 60, max: 5 } },
  },
  plugins: [
    // This validates x-captcha-response inside Better Auth itself. The old
    // client-side verification endpoint is intentionally not an authority.
    captcha({
      provider: "cloudflare-turnstile",
      secretKey:
        process.env.TURNSTILE_SECRET_KEY ?? "turnstile-secret-not-configured",
      endpoints: ["/sign-in/email"],
    }),
    twoFactor({
      issuer: "Hanuja Admin",
      totpOptions: { digits: 6, period: 30 },
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
        name?: string | null;
        twoFactorEnabled?: boolean;
      };
    } | null>;
    requestPasswordReset: (opts: {
      body: { email: string; redirectTo?: string };
    }) => Promise<unknown>;
    changePassword: (opts: {
      headers: Headers;
      body: {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions: boolean;
      };
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
export const authHandler = async (request: Request): Promise<Response> => {
  const dbErrorResponse = await ensureDatabaseConnection(request);

  if (dbErrorResponse) {
    return dbErrorResponse;
  }

  return _auth.handler(request);
};
