/**
 * Payment route handlers.
 * Admin-only: EFT approval/rejection.
 * Webhook: card payment confirmation from Iyzico.
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
    const { evidenceNote } = z
      .object({ evidenceNote: z.string().optional() })
      .parse(body)
    const svc = getPaymentService()
    const result = await svc.approveEftPayment({
      orderId,
      adminActorId,
      ...(evidenceNote !== undefined ? { evidenceNote } : {}),
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

// POST /api/webhooks/iyzico — called by Iyzico after card payment
// Signature verification is done in the Next.js route before calling this.
export async function handleIyzicoWebhook(params: {
  orderId: string
  providerRef: string
  amount: import('@prisma/client/runtime/client').Decimal
}) {
  try {
    const svc = getPaymentService()
    const result = await svc.confirmCardPayment(params)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
