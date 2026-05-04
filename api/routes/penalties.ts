/**
 * Penalty route handlers.
 * Seller: view own penalties.
 * Admin: list, waive.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
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
    const query = url.searchParams.get('q')?.trim() ?? undefined
    const from = url.searchParams.get('from')?.trim()
    const to = url.searchParams.get('to')?.trim()
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getPenaltyService()
    const penalties = await svc.listForAdmin({
      ...(sellerId !== undefined ? { sellerId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(query ? { query } : {}),
      ...(from ? { from: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { to: new Date(`${to}T23:59:59.999Z`) } : {}),
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

export async function applyManualPenalty(
  req: NextRequest,
  orderId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { sellerId, manualReason, penaltyAmount } = z.object({
      sellerId: z.string().min(1),
      manualReason: z.string().min(10, 'Ceza gerekçesi en az 10 karakter olmalı'),
      penaltyAmount: z.number().positive().optional(),
    }).parse(body)

    const svc = getPenaltyService()
    const result = await svc.applyManually({
      orderId,
      sellerId,
      adminActorId,
      manualReason,
      ...(penaltyAmount !== undefined ? { penaltyAmount: new Decimal(penaltyAmount) } : {}),
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
