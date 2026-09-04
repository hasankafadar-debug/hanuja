import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '../lib/prisma'
import { handleError, ok } from '../lib/response'
import { createQuantityRefundService } from '../services/quantity-refund.service'

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
