/**
 * Better Auth — shared server configuration factory.
 *
 * Used by each Next.js app's own `src/lib/auth.ts` to build an auth instance
 * connected to the same PostgreSQL database.
 *
 * Roles: customer (default) | seller | admin
 * Strategy: email + password, expandable to OAuth providers later.
 */
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { admin as adminPlugin } from 'better-auth/plugins'
import type { PrismaClient } from '@prisma/client'

export interface AuthConfig {
  /** Full public URL of this app, e.g. http://localhost:3000 */
  baseURL: string
  /** App-level BETTER_AUTH_SECRET */
  secret: string
  /** Shared PrismaClient instance */
  prisma: PrismaClient
  /**
   * Origins allowed to make auth requests.
   * Defaults to just this app's baseURL.
   * In production add other panel URLs when using shared cookie domain.
   */
  trustedOrigins?: string[]
}

/**
 * Creates a Better Auth instance for the given app.
 * Each Next.js app calls this once in its own `src/lib/auth.ts`.
 */
export function createAuth({ baseURL, secret, prisma, trustedOrigins }: AuthConfig) {
  return betterAuth({
    baseURL,
    secret,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    // ─── Email + Password ────────────────────────────────────────────────────
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // enable in production with SMTP
      minPasswordLength: 8,
    },

    // ─── Session ─────────────────────────────────────────────────────────────
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24,       // refresh session daily
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5-minute client-side cache
      },
    },

    // ─── Admin plugin (role, banned, banReason, banExpires) ──────────────────
    plugins: [
      adminPlugin({
        defaultRole: 'customer',
        adminRoles: ['admin'],
      }),
    ],

    // ─── CORS / trusted origins ───────────────────────────────────────────────
    trustedOrigins: trustedOrigins ?? [baseURL],

    // ─── Additional user fields stored alongside Better Auth defaults ─────────
    user: {
      additionalFields: {
        // `role` is managed by the admin plugin, but we surface it here
        // so TypeScript inference works correctly across the project.
        role: {
          type: 'string',
          defaultValue: 'customer',
          input: false, // not settable by the end user
        },
        phone: {
          type: 'string',
          required: false,
          input: true,
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
