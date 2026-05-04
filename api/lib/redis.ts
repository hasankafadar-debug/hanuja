import { Redis } from 'ioredis'

const globalForRedis = globalThis as unknown as { redis?: Redis }

/**
 * Shared Redis client — singleton to prevent connection leaks in dev hot-reload.
 * Initialization is lazy so route/module imports during build do not require
 * production Redis envs until a queue or worker is actually used.
 */
function resolveRedisUrl(): string {
  return (
    process.env.REDIS_URL ??
    (process.env.NODE_ENV === 'production'
      ? (() => {
          throw new Error('REDIS_URL is required in production')
        })()
      : 'redis://localhost:6379')
  )
}

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(resolveRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  }

  return globalForRedis.redis
}

export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const client = getRedis()
    const value = Reflect.get(client as object, prop, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export default redis
