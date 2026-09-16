import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '../lib/prisma'
import { handleError, ok } from '../lib/response'
import { createQuantityRefundService } from '../services/quantity-refund.service'
import { createRefundService } from '../services/refund.service'

export async function reassessLegacyRefund(request: NextRequest, refundId: string, actorId: string) {
  try {
    const body = z.object({ reason: z.string().trim().min(10).max(1000), expectedUpdatedAt: z.string().datetime() })
      .parse(await request.json().catch(() => null))
    const refund = await createRefundService({ prisma: createPrismaForRoute() })
      .reassessLegacyRefund({ refundId, actorId, ...body })
    return ok({ id: refund.id, orderId: refund.orderId, status: refund.status })
  } catch (error) { return handleError(error) }
}

const manualCompletionSchema = z.object({
  orderId: z.string().trim().min(1).max(100),
  providerReference: z.string().trim().min(3, 'Banka işlem referansı en az 3 karakter olmalıdır.').max(200),
  expectedOutstandingAmount: z.string().regex(/^\d{1,10}\.\d{2}$/),
  paymentMade: z.literal(true),
})

export async function completeManualRefund(
  request: NextRequest,
  refundTransactionId: string,
  adminActorId: string,
) {
  try {
    const body = manualCompletionSchema.parse(await request.json().catch(() => null))
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
    const refund = await createQuantityRefundService({
      prisma: createPrismaForRoute(),
    }).complete({
      refundTransactionId,
      orderId: body.orderId,
      actorId: adminActorId,
      providerReference: body.providerReference,
      expectedOutstandingAmount: body.expectedOutstandingAmount,
      ...(ipAddress ? { ipAddress } : {}),
    })
    return ok({
      id: refund.id,
      orderId: refund.orderId,
      status: refund.status,
      completedAt: refund.completedAt,
      providerReference: refund.providerReference,
    })
  } catch (error) {
    return handleError(error)
  }
}
