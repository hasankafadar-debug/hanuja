import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

const bodySchema = z.object({
  status: z.enum(['active', 'suspended', 'rejected']),
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
    const body = await req.json()
    const { status, reason } = bodySchema.parse(body)

    const prisma = createPrismaForRoute()
    const sellers = createSellerRepository(prisma)
    const auditLog = createAdminAuditLogRepository(prisma)

    const seller = await sellers.findById(id)
    if (!seller) throw new NotFoundError('Seller', id)

    await sellers.updateStatus(id, status)

    const actionType =
      status === 'suspended'
        ? ('seller_suspended' as const)
        : status === 'rejected'
        ? ('seller_rejected' as const)
        : ('seller_activated' as const)

    await auditLog.createEntry({
      actorId: session.user.id,
      actionType,
      targetType: 'seller',
      targetId: id,
      previousData: { status: seller.status },
      newData: { status },
      ...(reason !== undefined ? { reason } : {}),
    })

    return ok({ updated: true, status })
  } catch (err) {
    return handleError(err)
  }
}
