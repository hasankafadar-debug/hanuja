import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createDeliveryService } from '@hanuja/api/services/delivery.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

const bodySchema = z.object({
  reason: z.string().optional(),
  // Per-line confirmation: if provided, only the listed lines are stamped and
  // the order only transitions to delivery_confirmed when ALL lines are done.
  // Omitting the array preserves the legacy order-level behaviour.
  orderLineIds: z.array(z.string().min(1)).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { reason, orderLineIds } = bodySchema.parse(body)

    const prisma = createPrismaForRoute()
    const svc = createDeliveryService({ prisma })
    const result = await svc.confirmByAdmin({
      orderId: id,
      adminActorId: session.user.id,
      ...(reason !== undefined ? { reason } : {}),
      ...(orderLineIds !== undefined ? { orderLineIds } : {}),
    })

    return ok({
      confirmed: true,
      allLinesConfirmed: result?.allLinesConfirmed ?? true,
      confirmedLineIds: result?.confirmedLineIds ?? [],
    })
  } catch (err) {
    return handleError(err)
  }
}
