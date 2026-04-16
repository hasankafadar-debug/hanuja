/**
 * Health check endpoint — GET /api/health
 *
 * Checks connectivity to PostgreSQL and Redis.
 * Returns 200 when all healthy, 503 when any dependency is down.
 *
 * Used by: Docker health checks, Coolify readiness probes, monitoring.
 */
import { NextResponse } from 'next/server'
import prisma from '@hanuja/api/lib/prisma'

interface ServiceStatus {
  status: 'ok' | 'error'
  latencyMs?: number
  error?: string
}

interface HealthResponse {
  status: 'healthy' | 'degraded'
  timestamp: string
  services: {
    database: ServiceStatus
    redis: ServiceStatus
  }
}

async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    const { redis } = await import('@hanuja/api/lib/redis')
    await redis.ping()
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()])

  const allHealthy = database.status === 'ok' && redis.status === 'ok'

  const body: HealthResponse = {
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: { database, redis },
  }

  return NextResponse.json(body, { status: allHealthy ? 200 : 503 })
}
