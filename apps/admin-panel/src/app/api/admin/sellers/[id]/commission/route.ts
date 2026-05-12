import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'

const schema = z.object({
  commissionRateOverride: z.number().min(0).max(1).nullable(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const body = schema.parse(await req.json())
    const { id } = await params
    const prisma = createPrismaForRoute()
    const auditLog = createAdminAuditLogRepository(prisma)

    const seller = await prisma.seller.findUnique({
      where: { id },
      select: { id: true, commissionRateOverride: true },
    })
    if (!seller) throw new NotFoundError('Seller', id)

    const nextRate =
      body.commissionRateOverride === null ? null : new Decimal(body.commissionRateOverride)

    await prisma.seller.update({
      where: { id },
      data: {
        commissionRateOverride: nextRate,
      },
    })

    await auditLog.createEntry({
      actorId: session.user.id,
      actionType: 'seller_commission_rate_changed',
      targetType: 'seller',
      targetId: id,
      previousData: {
        commissionRateOverride: seller.commissionRateOverride?.toString() ?? null,
      },
      newData: {
        commissionRateOverride: nextRate?.toString() ?? null,
      },
    })

    return ok({
      updated: true,
      commissionRateOverride: nextRate?.toString() ?? null,
    })
  } catch (error) {
    return handleError(error)
  }
}
