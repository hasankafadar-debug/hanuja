import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createPayoutService } from '@hanuja/api/services/payout.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const bodySchema = z.object({
  reason: z.string().trim().min(5, 'Gerekçe en az 5 karakter olmalı'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError

    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id: orderId } = await params
    const body = await req.json()
    const { reason } = bodySchema.parse(body)

    const prisma = createPrismaForRoute()
    const payouts = createPayoutRepository(prisma)
    const orderPayouts = await payouts.findManyByOrderId(orderId)
    if (!orderPayouts.length) throw new NotFoundError('Payout', orderId)
    const service = createPayoutService({ prisma })
    for (const payout of orderPayouts) {
      if (payout.status !== 'payout_paid') {
        await service.block({ payoutId: payout.id, adminActorId: session.user.id, reason })
      }
    }

    return ok({ blocked: true })
  } catch (err) {
    return handleError(err)
  }
}
