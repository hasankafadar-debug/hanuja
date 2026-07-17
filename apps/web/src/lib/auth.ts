import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin as adminPlugin } from 'better-auth/plugins'
import { PrismaClient } from '@prisma/client'
import { sendEmail } from '@hanuja/api/lib/mailer'
import { emailVerificationTemplate } from '@hanuja/api/lib/email-templates/email-verification'
import { passwordResetTemplate } from '@hanuja/api/lib/email-templates/password-reset'
import { passwordChangedTemplate } from '@hanuja/api/lib/email-templates/password-changed'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

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

async function ensureDatabaseConnection(request: Request): Promise<Response | null> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    console.error('[auth] Database readiness check failed.', {
      url: request.url,
      message,
    })

    return Response.json(
      {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Giris hizmetine su anda ulasilamiyor. Lutfen biraz sonra tekrar deneyin.',
      },
      { status: 503 },
    )
  }
}

const _auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? 'change-me-in-production',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      const template = passwordResetTemplate({ resetUrl: url })
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      })
    },
    onPasswordReset: async ({ user }) => {
      const template = passwordChangedTemplate({ changedAt: new Date() })
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }).catch(console.error)
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
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  rateLimit: { enabled: true, window: 60, max: 60, customRules: { '/change-password': { window: 60, max: 5 } } },
  plugins: [adminPlugin({ defaultRole: 'customer', adminRoles: ['admin'] })],
  trustedOrigins: expandTrustedOriginVariants([
    baseURL,
    process.env.SELLER_PANEL_URL ?? 'http://localhost:3001',
    process.env.ADMIN_PANEL_URL ?? 'http://localhost:3002',
  ]),
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'customer', input: false },
      phone: { type: 'string', required: false, input: true },
    },
  },
}) as {
  handler: (request: Request) => Promise<Response>
  api: {
    getSession: (opts: { headers: Headers }) => Promise<{
      user: { id: string; email: string; emailVerified: boolean; role: string }
    } | null>
    sendVerificationEmail: (opts: {
      body: { callbackURL?: string; email: string }
    }) => Promise<unknown>
    changePassword: (opts: {
      headers: Headers
      body: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }
    }) => Promise<unknown>
  }
}

export const auth = _auth
export const authHandler = async (request: Request): Promise<Response> => {
  const dbErrorResponse = await ensureDatabaseConnection(request)

  if (dbErrorResponse) {
    return dbErrorResponse
  }

  return _auth.handler(request)
}
