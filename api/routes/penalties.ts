/**
 * Penalty route handlers.
 * Seller: view own penalties.
 * Admin: list, waive.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { createPenaltyService } from '../services/penalty.service'
import { createPrismaForRoute } from '../lib/prisma'

function getPenaltyService() {
  return createPenaltyService({ prisma: createPrismaForRoute() })
}

// GET /api/seller/penalties
export async function listSellerPenalties(req: NextRequest, sellerId: string) {
  try {
    const url = new URL(req.url)
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getPenaltyService()
    const penalties = await svc.listForSeller(sellerId, skip, take)
    return ok(penalties)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/penalties
export async function listAdminPenalties(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const sellerId = url.searchParams.get('sellerId') ?? undefined
    const status = url.searchParams.get('status') ?? undefined
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getPenaltyService()
    const penalties = await svc.listForAdmin({
      ...(sellerId !== undefined ? { sellerId } : {}),
      status: status as never,
      skip,
      take,
    })
    return ok(penalties)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/penalties/:penaltyId/waive — admin only, reason required
export async function waivePenalty(
  req: NextRequest,
  penaltyId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { waiverReason } = z
      .object({ waiverReason: z.string().min(10, 'Muafiyet gerekçesi en az 10 karakter') })
      .parse(body)
    const svc = getPenaltyService()
    const result = await svc.waive({ penaltyId, adminActorId, waiverReason })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
