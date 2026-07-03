/**
 * Unit tests — Redis destekli sliding-window rate limiter.
 *
 * Davranış sözleşmesi:
 * - REDIS_URL yoksa bellek-içi limiter'a delege edilir (dev senaryosu)
 * - Limit altında: allowed=true, remaining doğru hesaplanır
 * - Limit aşımında: allowed=false, kendi kaydı geri alınır (zrem),
 *   resetAt penceredeki en eski kayıttan türetilir
 * - Redis hatasında bellek-içi limiter'a düşülür (fail-open, belgeli tercih)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getRedisMock } = vi.hoisted(() => ({
  getRedisMock: vi.fn(),
}))

vi.mock('../../api/lib/redis', () => ({
  getRedis: getRedisMock,
}))

import { rateLimitRedis } from '../../api/lib/rate-limit-redis'

interface FakeMulti {
  zremrangebyscore: () => FakeMulti
  zadd: () => FakeMulti
  zcard: () => FakeMulti
  pexpire: () => FakeMulti
  exec: () => Promise<Array<[Error | null, unknown]>>
}

function buildFakeRedis(options: { count: number; oldestScore?: number }) {
  const zrem = vi.fn(async () => 1)
  const zrange = vi.fn(async () =>
    options.oldestScore !== undefined ? ['member-x', String(options.oldestScore)] : [],
  )
  const multi: FakeMulti = {
    zremrangebyscore: () => multi,
    zadd: () => multi,
    zcard: () => multi,
    pexpire: () => multi,
    exec: async () => [
      [null, 0],
      [null, 1],
      [null, options.count],
      [null, 1],
    ],
  }
  return {
    client: { multi: () => multi, zrem, zrange },
    zrem,
    zrange,
  }
}

const CONFIG = { limit: 5, windowMs: 60_000 }
const ORIGINAL_REDIS_URL = process.env.REDIS_URL

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  if (ORIGINAL_REDIS_URL === undefined) {
    delete process.env.REDIS_URL
  } else {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL
  }
})

describe('rateLimitRedis — REDIS_URL yokken', () => {
  it('bellek-içi limiter\'a delege eder, Redis istemcisine hiç dokunmaz', async () => {
    delete process.env.REDIS_URL

    const result = await rateLimitRedis('mem-key-1', CONFIG)

    expect(result.allowed).toBe(true)
    expect(getRedisMock).not.toHaveBeenCalled()
  })

  it('bellek-içi pencere matematiği çalışır: limit dolunca reddeder', async () => {
    delete process.env.REDIS_URL

    for (let i = 0; i < CONFIG.limit; i += 1) {
      const r = await rateLimitRedis('mem-key-2', CONFIG)
      expect(r.allowed).toBe(true)
    }
    const rejected = await rateLimitRedis('mem-key-2', CONFIG)
    expect(rejected.allowed).toBe(false)
    expect(rejected.remaining).toBe(0)
  })
})

describe('rateLimitRedis — Redis aktifken', () => {
  it('limit altında isteğe izin verir ve remaining hesaplar', async () => {
    process.env.REDIS_URL = 'redis://test:6379'
    const fake = buildFakeRedis({ count: 3 })
    getRedisMock.mockReturnValue(fake.client)

    const result = await rateLimitRedis('redis-key-1', CONFIG)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2) // limit 5 - count 3
    expect(fake.zrem).not.toHaveBeenCalled()
  })

  it('limit aşımında reddeder, kendi kaydını geri alır ve resetAt en eskiden türer', async () => {
    process.env.REDIS_URL = 'redis://test:6379'
    const oldestScore = Date.now() - 30_000
    const fake = buildFakeRedis({ count: 6, oldestScore })
    getRedisMock.mockReturnValue(fake.client)

    const result = await rateLimitRedis('redis-key-2', CONFIG)

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(fake.zrem).toHaveBeenCalledTimes(1)
    expect(result.resetAt).toBe(oldestScore + CONFIG.windowMs)
  })

  it('Redis hatasında bellek-içi limiter\'a düşer (fail-open)', async () => {
    process.env.REDIS_URL = 'redis://test:6379'
    getRedisMock.mockImplementation(() => {
      throw new Error('bağlantı koptu')
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await rateLimitRedis('redis-key-3', CONFIG)

    expect(result.allowed).toBe(true)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
