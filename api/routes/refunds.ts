import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '../lib/prisma'
import { handleError, ok } from '../lib/response'
import { createQuantityRefundService } from '../services/quantity-refund.service'

const manualCompletionSchema = z.object({
  providerReference: z.string().trim().min(3).max(200),
})

export async function completeManualRefund(
  request: NextRequest,
  refundTransactionId: string,
  adminActorId: string,
) {
  try {
    const body = manualCompletionSchema.parse(await request.json())
    const refund = await createQuantityRefundService({
      prisma: createPrismaForRoute(),
    }).complete({
      refundTransactionId,
      actorId: adminActorId,
      providerReference: body.providerReference,
    })
    return ok(refund)
  } catch (error) {
    return handleError(error)
  }
}
