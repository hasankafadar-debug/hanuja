import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin as adminPlugin } from 'better-auth/plugins'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

const _auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? 'change-me-in-production',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 8 },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  plugins: [adminPlugin({ defaultRole: 'customer', adminRoles: ['admin'] })],
  trustedOrigins: [
    baseURL,
    process.env.SELLER_PANEL_URL ?? 'http://localhost:3001',
    process.env.ADMIN_PANEL_URL ?? 'http://localhost:3002',
  ],
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'customer', input: false },
      phone: { type: 'string', required: false, input: true },
    },
  },
}) as {
  handler: (request: Request) => Promise<Response>
  api: {
    getSession: (opts: { headers: Headers }) => Promise<{ user: { id: string; email: string; role: string } } | null>
  }
}

export const auth = _auth
export const authHandler: (request: Request) => Promise<Response> = _auth.handler
