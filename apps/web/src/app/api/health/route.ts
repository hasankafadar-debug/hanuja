/**
 * Health check endpoint — GET /api/health
 *
 * Checks connectivity to PostgreSQL, Redis, and Meilisearch.
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
    meilisearch: ServiceStatus
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

async function checkMeilisearch(): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    const meiliUrl = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700'
    const res = await fetch(`${meiliUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
  const [database, redis, meilisearch] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkMeilisearch(),
  ])

  const allHealthy =
    database.status === 'ok' &&
    redis.status === 'ok' &&
    meilisearch.status === 'ok'

  const body: HealthResponse = {
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: { database, redis, meilisearch },
  }

  return NextResponse.json(body, { status: allHealthy ? 200 : 503 })
}
