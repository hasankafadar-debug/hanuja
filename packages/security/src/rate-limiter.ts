/**
 * In-memory sliding-window rate limiter.
 *
 * Üretimde birincil yol `api/lib/rate-limit-redis.ts` (Redis destekli,
 * container'lar arası ortak pencere). Bu modül preset kaynağıdır ve
 * REDIS_URL yokken / Redis hatasında fallback olarak kullanılır.
 */

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

// Map<key, timestamps[]>
const store = new Map<string, number[]>()

// Cleanup old entries every 5 minutes to prevent memory growth
let cleanupScheduled = false
function scheduleCleanup() {
  if (cleanupScheduled) return
  cleanupScheduled = true
  const interval = setInterval(() => {
    const now = Date.now()
    for (const [key, timestamps] of store.entries()) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1]! > 600_000) {
        store.delete(key)
      }
    }
  }, 300_000)
  if (typeof interval === 'object' && interval !== null && 'unref' in interval) {
    // Node.js: don't keep process alive for cleanup
    const nodeInterval = interval as { unref(): void }
    nodeInterval.unref()
  }
}

/**
 * Check and record a request attempt for the given key.
 * @param key    Unique identifier (e.g. IP, userId, `ip:endpoint`)
 * @param config Rate limit configuration
 */
export function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  scheduleCleanup()

  const now = Date.now()
  const windowStart = now - config.windowMs

  const timestamps = (store.get(key) ?? []).filter((t) => t > windowStart)

  if (timestamps.length >= config.limit) {
    const oldestInWindow = timestamps[0] ?? now
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldestInWindow + config.windowMs,
    }
  }

  timestamps.push(now)
  store.set(key, timestamps)

  return {
    allowed: true,
    remaining: config.limit - timestamps.length,
    resetAt: now + config.windowMs,
  }
}

// ── Preset configs ────────────────────────────────────────────────────────────

/** Strict: login, password reset, registration */
export const AUTH_RATE_LIMIT: RateLimitConfig = { limit: 10, windowMs: 15 * 60 * 1000 }

/** Standard: general API endpoints */
export const API_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 }

/** Sensitive: checkout, payment attempts, coupon application */
export const SENSITIVE_RATE_LIMIT: RateLimitConfig = { limit: 20, windowMs: 60 * 1000 }

/** High-risk: seller bank detail changes, admin finance actions */
export const HIGH_RISK_RATE_LIMIT: RateLimitConfig = { limit: 5, windowMs: 15 * 60 * 1000 }
