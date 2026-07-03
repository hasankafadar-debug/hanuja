/**
 * Next.js App Router rate limit helper.
 * Redis destekli sliding-window limiter'ı sarar (REDIS_URL yoksa bellek-içi
 * fallback) ve route handler'lar için 429 response-ready sonuç döndürür.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  type RateLimitConfig,
  AUTH_RATE_LIMIT,
  API_RATE_LIMIT,
  SENSITIVE_RATE_LIMIT,
  HIGH_RISK_RATE_LIMIT,
} from '@hanuja/security'
import { rateLimitRedis } from './rate-limit-redis'

export { AUTH_RATE_LIMIT, API_RATE_LIMIT, SENSITIVE_RATE_LIMIT, HIGH_RISK_RATE_LIMIT }

// ── IP extraction ─────────────────────────────────────────────────────────────

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

// ── Core helper ───────────────────────────────────────────────────────────────

export interface RateLimitCheckResult {
  /** Rate limit passed — request may proceed */
  allowed: boolean
  /** 429 response to return immediately if not allowed */
  response: NextResponse | null
}

/**
 * Checks the rate limit for a request.
 * Returns { allowed: true, response: null } when the request may proceed.
 * Returns { allowed: false, response: NextResponse } when the limit is exceeded.
 *
 * @param req    The incoming Next.js request
 * @param key    Cache key suffix — e.g. userId or endpoint name
 * @param config Rate limit config (use preset constants or custom)
 *
 * @example
 * const { allowed, response } = await checkRateLimit(req, 'login', AUTH_RATE_LIMIT)
 * if (!allowed) return response!
 */
export async function checkRateLimit(
  req: NextRequest,
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitCheckResult> {
  const ip = getClientIp(req)
  const rateLimitKey = `${ip}:${key}`
  const result = await rateLimitRedis(rateLimitKey, config)

  if (result.allowed) {
    return { allowed: true, response: null }
  }

  const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000)

  const response = NextResponse.json(
    {
      error: 'Çok fazla istek gönderildi. Lütfen bir süre bekleyin.',
      retryAfter: retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      },
    },
  )

  return { allowed: false, response }
}

/**
 * Convenience: rate-limit by authenticated user ID (preferred over IP for logged-in routes).
 */
export async function checkUserRateLimit(
  userId: string,
  key: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; response: NextResponse | null }> {
  const result = await rateLimitRedis(`user:${userId}:${key}`, config)

  if (result.allowed) return { allowed: true, response: null }

  const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000)
  return {
    allowed: false,
    response: NextResponse.json(
      { error: 'Çok fazla istek. Lütfen bekleyin.', retryAfter: retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    ),
  }
}
