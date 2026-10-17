/**
 * Payment route handlers.
 * Admin-only: EFT approval/rejection. Card payments: api/routes/card-payments.ts.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { createPaymentService } from '../services/payment.service'
import { createPrismaForRoute } from '../lib/prisma'

function getPaymentService() {
  return createPaymentService({ prisma: createPrismaForRoute() })
}

// GET /api/admin/payments/eft/pending
export async function listPendingEft() {
  try {
    const svc = getPaymentService()
    const items = await svc.getPendingEftList()
    return ok(items)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/payments/eft/:orderId/approve
export async function approveEft(
  req: NextRequest,
  orderId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const parsed = z
      .object({
        evidenceNote: z.string().optional(),
        discountAmount: z.number().int().min(0).optional(), // Kuruş cinsinden (1 TRY = 100)
        discountReason: z.string().max(200).optional(),
      })
      .parse(body)
    const svc = getPaymentService()
    const result = await svc.approveEftPayment({
      orderId,
      adminActorId,
      ...(parsed.evidenceNote !== undefined ? { evidenceNote: parsed.evidenceNote } : {}),
      ...(parsed.discountAmount !== undefined ? { discountAmount: parsed.discountAmount } : {}),
      ...(parsed.discountReason !== undefined ? { discountReason: parsed.discountReason } : {}),
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/payments/eft/:orderId/reject
export async function rejectEft(
  req: NextRequest,
  orderId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { reason } = z.object({ reason: z.string().min(5) }).parse(body)
    const svc = getPaymentService()
    const result = await svc.rejectEftPayment({ orderId, adminActorId, reason })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
