import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const prisma = createPrismaForRoute()
    const auditLog = createAdminAuditLogRepository(prisma)

    const seller = await prisma.seller.findUnique({
      where: { id },
      select: { id: true, importEnabled: true, importRequestedAt: true },
    })
    if (!seller) throw new NotFoundError('Seller', id)

    if (seller.importEnabled) {
      return ok({ enabled: true, alreadyEnabled: true })
    }

    await prisma.seller.update({
      where: { id: seller.id },
      data: { importEnabled: true },
    })

    await auditLog.createEntry({
      actorId: session.user.id,
      actionType: 'seller_import_permission_granted',
      targetType: 'seller',
      targetId: seller.id,
      previousData: {
        importEnabled: false,
        importRequestedAt: seller.importRequestedAt?.toISOString() ?? null,
      },
      newData: { importEnabled: true },
    })

    return ok({ enabled: true })
  } catch (err) {
    return handleError(err)
  }
}
