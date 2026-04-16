import { Redis } from 'ioredis'

const globalForRedis = globalThis as unknown as { redis?: Redis }

/**
 * Shared Redis client — singleton to prevent connection leaks in dev hot-reload.
 * maxRetriesPerRequest: null is required by BullMQ.
 */
export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
}

export default redis
