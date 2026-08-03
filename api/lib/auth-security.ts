/**
 * Server-side controls shared by privileged authentication flows.
 *
 * Grants are deliberately held only in Redis: a process-local fallback would
 * allow a critical action during a Redis outage and would not be shared across
 * replicas. Tokens are opaque, single-use, capability-scoped and expire after
 * five minutes.
 */
import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { symmetricDecrypt } from 'better-auth/crypto'
import { createOTP } from '@better-auth/utils/otp'
import { requireRuntimeSecret } from '@hanuja/config/env'
import { getRedis } from './redis'
import { StepUpRequiredError } from './errors'

export const CRITICAL_CAPABILITIES = [
  'eft:approve',
  'eft:reject',
  'delivery:manual-confirmation',
  'payout:release',
  'payout:block',
  'payout:release-hold',
  'penalty:apply',
  'penalty:waive',
  'finance:adjustment',
  'order:admin-cancel',
  'seller-bank:approve',
  'seller-bank:block',
  'seller:password-reset',
  'seller:suspend',
  'seller:reactivate',
  'admin:security-permissions',
] as const

export type CriticalCapability = (typeof CRITICAL_CAPABILITIES)[number]
const STEP_UP_PREFIX = 'auth:step-up:'
const STEP_UP_TTL_SECONDS = 5 * 60

type Grant = { userId: string; sessionId: string; capability: CriticalCapability }

function requireSecret(): string {
  return requireRuntimeSecret('BETTER_AUTH_SECRET', process.env.BETTER_AUTH_SECRET)
}

/** Strict fixed-window limit: Redis failure is an error, never an in-memory fallback. */
export async function requireStrictRateLimit(
  key: string,
  limit = 10,
  windowSeconds = 15 * 60,
): Promise<void> {
  const redis = getRedis()
  const redisKey = `auth:strict-rl:${key}`
  const count = await redis.incr(redisKey)
  if (count === 1) await redis.expire(redisKey, windowSeconds)
  if (count > limit) {
    const error = new Error('AUTH_RATE_LIMITED')
    ;(error as Error & { statusCode?: number }).statusCode = 429
    throw error
  }
}

export async function verifyAdminTotp(
  prisma: PrismaClient,
  userId: string,
  code: string,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false
  const factor = await prisma.twoFactor.findUnique({ where: { userId }, select: { secret: true } })
  if (!factor) return false
  const secret = await symmetricDecrypt({ key: requireSecret(), data: factor.secret })
  return createOTP(secret, { digits: 6, period: 30 }).verify(code)
}

export async function issueStepUpGrant(grant: Grant): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await getRedis().set(
    `${STEP_UP_PREFIX}${token}`,
    JSON.stringify(grant),
    'EX',
    STEP_UP_TTL_SECONDS,
  )
  return token
}

/** Atomically consumes a capability-specific grant. Redis unavailability fails closed. */
export async function consumeStepUpGrant(token: string | null, expected: Grant): Promise<void> {
  if (!token) throw new StepUpRequiredError()
  const redis = getRedis()
  const key = `${STEP_UP_PREFIX}${token}`
  // GETDEL is atomic on Redis 6.2+. Lua retains atomic behaviour on older hosts.
  const raw = await redis.eval(
    'local v=redis.call("GET", KEYS[1]); if v then redis.call("DEL", KEYS[1]); end; return v',
    1,
    key,
  )
  if (typeof raw !== 'string') throw new StepUpRequiredError()
  let grant: Grant
  try {
    grant = JSON.parse(raw) as Grant
  } catch {
    throw new StepUpRequiredError()
  }
  if (
    grant.userId !== expected.userId ||
    grant.sessionId !== expected.sessionId ||
    grant.capability !== expected.capability
  ) {
    throw new StepUpRequiredError()
  }
}

export async function revokeTrustedDevices(prisma: PrismaClient, userId: string): Promise<void> {
  // Better Auth trust records have a random `trust-device-` identifier and the
  // user id as their value. This also covers every browser, not just this one.
  await prisma.verification.deleteMany({
    where: { value: userId, identifier: { startsWith: 'trust-device-' } },
  })
}
