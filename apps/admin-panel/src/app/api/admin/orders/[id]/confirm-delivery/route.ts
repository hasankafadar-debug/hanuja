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
    const { reason } = bodySchema.parse(body)

    const prisma = createPrismaForRoute()
    const svc = createDeliveryService({ prisma })
    await svc.confirmByAdmin({
      orderId: id,
      adminActorId: session.user.id,
      ...(reason !== undefined ? { reason } : {}),
    })

    return ok({ confirmed: true })
  } catch (err) {
    return handleError(err)
  }
}
