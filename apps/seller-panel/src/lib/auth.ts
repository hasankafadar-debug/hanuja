/**
 * Better Auth server instance — seller panel (apps/seller-panel).
 *
 * Self-contained: does not import from api/ to avoid Next.js build path issues.
 * Seller access is enforced by middleware (role === 'seller' required).
 */
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin as adminPlugin } from 'better-auth/plugins'
import { PrismaClient } from '@prisma/client'
import { sendEmail } from '@hanuja/api/lib/mailer'
import { emailVerificationTemplate } from '@hanuja/api/lib/email-templates/email-verification'
import { sellerPasswordResetTemplate } from '@hanuja/api/lib/email-templates/seller-password-reset'
import { evaluateAuthPasswordPolicy } from '@hanuja/security/password-policy'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001'

function expandTrustedOriginVariants(urls: Array<string | undefined>): string[] {
  const origins = new Set<string>()

  for (const value of urls) {
    if (!value) continue

    try {
      const url = new URL(value)
      origins.add(url.origin)

      if (process.env.NODE_ENV === 'development') {
        if (url.hostname === 'localhost') {
          origins.add(`${url.protocol}//127.0.0.1:${url.port}`)
        }

        if (url.hostname === '127.0.0.1') {
          origins.add(`${url.protocol}//localhost:${url.port}`)
        }
      }
    } catch {
      // Ignore malformed optional env values and keep explicit defaults working.
    }
  }

  return Array.from(origins)
}

const _auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? 'change-me-in-production',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  rateLimit: { enabled: true, window: 60, max: 60, customRules: { '/change-password': { window: 60, max: 5 } } },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const message = evaluateAuthPasswordPolicy(ctx.path, ctx.body, 'seller')
      if (message) {
        throw new APIError('BAD_REQUEST', { message })
      }
    }),
  },
  plugins: [adminPlugin({ defaultRole: 'customer', adminRoles: ['admin'] })],
  trustedOrigins: expandTrustedOriginVariants([
    baseURL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.SELLER_PANEL_URL,
    process.env.ADMIN_PANEL_URL,
  ]),
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'customer', input: false },
      phone: { type: 'string', required: false, input: true },
      mustChangePassword: { type: 'boolean', defaultValue: false, input: false },
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
      })
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const template = emailVerificationTemplate({
        email: user.email,
        verificationUrl: url,
      })

      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      })
    },
  },
}) as unknown as {
  handler: (request: Request) => Promise<Response>
  api: {
    getSession: (opts: { headers: Headers }) => Promise<{
      user: {
        id: string
        email: string
        emailVerified: boolean
        role: string
        mustChangePassword?: boolean
        phone?: string
      }
    } | null>
    setPassword: (opts: { headers: Headers; body: { newPassword: string } }) => Promise<unknown>
    changePassword: (opts: { headers: Headers; body: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean } }) => Promise<unknown>
    requestPasswordReset: (opts: { body: { email: string; redirectTo?: string } }) => Promise<unknown>
    resetPassword: (opts: { body: { newPassword: string; token?: string } }) => Promise<unknown>
    sendVerificationEmail: (opts: {
      body: { callbackURL?: string; email: string }
    }) => Promise<unknown>
    admin: {
      setUserPassword: (opts: { headers: Headers; body: { userId: string; newPassword: string } }) => Promise<unknown>
    }
  }
}

export const auth = _auth
export const authHandler: (request: Request) => Promise<Response> = _auth.handler
