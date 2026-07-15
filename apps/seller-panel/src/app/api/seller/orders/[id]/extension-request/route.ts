import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { NotFoundError } from '@hanuja/api/lib/errors'
import { createExtensionRequestService } from '@hanuja/api/services/extension-request.service'
import { getOperationalSellerIdOrThrow } from '@/lib/route-seller'

const bodySchema = z.object({
  requestedDays: z.number().int().min(1).max(30),
  sellerReason: z.string().trim().min(1).max(2000),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sellerId = await getOperationalSellerIdOrThrow()
    const { id: orderId } = await params
    const body = bodySchema.parse(await req.json())

    const prisma = createPrismaForRoute()

    // Verify seller owns at least one line on this order
    const owned = await prisma.orderLine.findFirst({
      where: { orderId, sellerId },
      select: { id: true },
    })
    if (!owned) throw new NotFoundError('Order', orderId)

    const service = createExtensionRequestService({ prisma })
    const request = await service.createBySeller({
      orderId,
      sellerId,
      requestedDays: body.requestedDays,
      sellerReason: body.sellerReason,
    })

    return ok({ request })
  } catch (error) {
    return handleError(error)
  }
}
