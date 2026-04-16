/**
 * Admin analytics route handlers.
 * All endpoints require admin role — enforced in Next.js route handlers.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { createAdminAnalyticsService } from '../services/admin-analytics.service'
import { createPrismaForRoute } from '../lib/prisma'

function getService() {
  return createAdminAnalyticsService({ prisma: createPrismaForRoute() })
}

// GET /api/admin/analytics/dashboard
export async function getDashboardStats(_req: NextRequest) {
  try {
    const service = getService()
    const stats = await service.getDashboardStats()
    return ok(stats)
  } catch (err) {
    return handleError(err)
  }
}

const sellerFinanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  negativeOnly: z.coerce.boolean().default(false),
})

// GET /api/admin/analytics/seller-finances
export async function getSellerFinanceSummaries(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const raw = Object.fromEntries(url.searchParams.entries())
    const params = sellerFinanceQuerySchema.parse(raw)

    const service = getService()
    const summaries = await service.getSellerFinanceSummaries({
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      negativeOnly: params.negativeOnly,
    })

    return ok({ summaries, page: params.page, limit: params.limit })
  } catch (err) {
    return handleError(err)
  }
}

const orderVolumeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
})

// GET /api/admin/analytics/order-volume
export async function getOrderVolume(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const raw = Object.fromEntries(url.searchParams.entries())
    const params = orderVolumeQuerySchema.parse(raw)

    const service = getService()
    const data = await service.getOrderVolumeByDay(params.days)
    return ok({ data, days: params.days })
  } catch (err) {
    return handleError(err)
  }
}
