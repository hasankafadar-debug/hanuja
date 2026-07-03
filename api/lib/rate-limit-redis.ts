/**
 * Redis-backed sliding-window rate limiter.
 *
 * Coolify'da her uygulama ayrı container olarak çalıştığı için bellek-içi
 * limiter instance başına sayar ve gerçek koruma sağlamaz. Bu modül aynı
 * preset API'sini paylaşan Redis (ioredis) tabanlı pencereyi uygular.
 *
 * Davranış tercihleri (belgeli):
 * - REDIS_URL tanımlı değilse (lokal dev) bellek-içi limiter'a delege edilir.
 * - Redis hatasında bellek-içi limiter'a düşülür (fail-open): rate limit
 *   erişilebilirlik korumasıdır; Redis kesintisi ödeme/checkout akışını
 *   durdurmamalıdır. Hata console.error ile görünür kılınır.
 *
 * See: docs/05-security/security-architecture.md
 */
import {
  rateLimit as memoryRateLimit,
  type RateLimitConfig,
  type RateLimitResult,
} from '@hanuja/security'
import { getRedis } from './redis'

const KEY_PREFIX = 'rl:'

export async function rateLimitRedis(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  if (!process.env.REDIS_URL) {
    return memoryRateLimit(key, config)
  }

  const redisKey = `${KEY_PREFIX}${key}`
  const now = Date.now()
  const windowStart = now - config.windowMs
  // Aynı milisaniyede birden çok istek çakışmasın diye benzersiz member
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`

  try {
    const redis = getRedis()
    const replies = await redis
      .multi()
      .zremrangebyscore(redisKey, 0, windowStart)
      .zadd(redisKey, now, member)
      .zcard(redisKey)
      .pexpire(redisKey, config.windowMs)
      .exec()

    const count = Number(replies?.[2]?.[1] ?? 0)

    if (count > config.limit) {
      // Limit aşıldı — kendi kaydımızı geri al ki reddedilen istek pencereyi uzatmasın
      await redis.zrem(redisKey, member)
      const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES')
      const oldestScore = oldest.length >= 2 ? Number(oldest[1]) : now
      return {
        allowed: false,
        remaining: 0,
        resetAt: oldestScore + config.windowMs,
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, config.limit - count),
      resetAt: now + config.windowMs,
    }
  } catch (error) {
    console.error('[rate-limit] Redis hatası, bellek-içi limiter\'a düşülüyor:', error)
    return memoryRateLimit(key, config)
  }
}
