/**
 * Payout route handlers.
 * Seller: view own payouts and summary.
 * Admin: list, release, block, mark paid.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { createPayoutService } from '../services/payout.service'
import { createPrismaForRoute } from '../lib/prisma'

function getPayoutService() {
  return createPayoutService({ prisma: createPrismaForRoute() })
}

// GET /api/seller/payouts
export async function listSellerPayouts(req: NextRequest, sellerId: string) {
  try {
    const url = new URL(req.url)
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getPayoutService()
    const payouts = await svc.listForSeller(sellerId, skip, take)
    return ok(payouts)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/seller/payouts/summary
export async function getSellerPayoutSummary(sellerId: string) {
  try {
    const svc = getPayoutService()
    const summary = await svc.getSummaryBySeller(sellerId)
    return ok(summary)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/payouts
export async function listAdminPayouts(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const sellerId = url.searchParams.get('sellerId') ?? undefined
    const status = url.searchParams.get('status') ?? undefined
    const holdUntilFrom = url.searchParams.get('from') ?? undefined
    const holdUntilTo = url.searchParams.get('to') ?? undefined
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getPayoutService()
    const payouts = await svc.listForAdmin({
      ...(sellerId !== undefined ? { sellerId } : {}),
      status: status as never,
      ...(holdUntilFrom ? { holdUntilFrom: new Date(`${holdUntilFrom}T00:00:00.000Z`) } : {}),
      ...(holdUntilTo ? { holdUntilTo: new Date(`${holdUntilTo}T23:59:59.999Z`) } : {}),
      skip,
      take,
    })
    return ok(payouts)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/payouts/:payoutId/release
export async function releasePayout(
  req: NextRequest,
  payoutId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const svc = getPayoutService()
    const parsed = z.object({
      reason: z.string().optional(),
      transferDate: z.string().datetime().optional(),
      transferReference: z.string().trim().optional(),
      transferBankName: z.string().trim().optional(),
      transferNote: z.string().trim().optional(),
      batchId: z.string().trim().optional(),
    }).parse(body)

    const result = parsed.transferDate
      ? await svc.markPaid({
          payoutId,
          adminActorId,
          transferDate: new Date(parsed.transferDate),
          ...(parsed.batchId !== undefined ? { batchId: parsed.batchId } : {}),
          ...(parsed.transferReference !== undefined ? { transferReference: parsed.transferReference } : {}),
          ...(parsed.transferBankName !== undefined ? { transferBankName: parsed.transferBankName } : {}),
          ...(parsed.transferNote !== undefined ? { transferNote: parsed.transferNote } : {}),
        })
      : await svc.release({
          payoutId,
          adminActorId,
          ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
        })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/payouts/:payoutId/block
export async function blockPayout(
  req: NextRequest,
  payoutId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { reason } = z.object({ reason: z.string().min(5) }).parse(body)
    const svc = getPayoutService()
    const result = await svc.block({ payoutId, adminActorId, reason })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/payouts/:payoutId/mark-paid
export async function markPayoutPaid(
  req: NextRequest,
  payoutId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { batchId, transferDate, transferReference, transferBankName, transferNote } = z.object({
      batchId: z.string().optional(),
      transferDate: z.string().datetime(),
      transferReference: z.string().trim().optional(),
      transferBankName: z.string().trim().optional(),
      transferNote: z.string().trim().optional(),
    }).parse(body)
    const svc = getPayoutService()
    const result = await svc.markPaid({
      payoutId,
      adminActorId,
      transferDate: new Date(transferDate),
      ...(batchId !== undefined ? { batchId } : {}),
      ...(transferReference !== undefined ? { transferReference } : {}),
      ...(transferBankName !== undefined ? { transferBankName } : {}),
      ...(transferNote !== undefined ? { transferNote } : {}),
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
