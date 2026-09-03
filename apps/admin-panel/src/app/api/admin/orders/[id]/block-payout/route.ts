import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const bodySchema = z.object({
  reason: z.string().min(3, 'Gerekçe en az 3 karakter olmalı'),
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
    const auditLog = createAdminAuditLogRepository(prisma)

    const payout = await payouts.findByOrderId(orderId)
    if (!payout) throw new NotFoundError('Payout', orderId)

    const prevStatus = payout.status
    await payouts.block(payout.id, reason)

    await auditLog.createEntry({
      actorId: session.user.id,
      actionType: 'payout_blocked',
      targetType: 'payout',
      targetId: payout.id,
      previousData: { status: prevStatus },
      newData: { status: 'payout_blocked', blockedReason: reason },
      reason,
    })

    return ok({ blocked: true })
  } catch (err) {
    return handleError(err)
  }
}
