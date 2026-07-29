import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { checkUserRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { handleError, ok } from '@hanuja/api/lib/response'
import { getSellerPanelUrl } from '@hanuja/api/lib/platform-info'
import { requireAdminStepUp } from '@/lib/step-up'
import { revokeTrustedDevices } from '@hanuja/api/lib/auth-security'

const bodySchema = z.object({
  reason: z.string().min(3).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    await requireAdminStepUp(req, session, 'seller:password-reset')

    const rl = await checkUserRateLimit(session.user.id, 'sellers:reset-password', HIGH_RISK_RATE_LIMIT)
    if (!rl.allowed) return rl.response!

    const body = bodySchema.parse(await req.json().catch(() => ({})))
    const { id } = await params
    const prisma = createPrismaForRoute()
    const auditLog = createAdminAuditLogRepository(prisma)

    const seller = await prisma.seller.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    })
    if (!seller) throw new NotFoundError('Seller', id)
    await revokeTrustedDevices(prisma, seller.userId)

    await auth.api.requestPasswordReset({
      body: {
        email: seller.user.email,
        redirectTo: `${getSellerPanelUrl()}/sifre-sifirla`,
      },
    })

    await auditLog.createEntry({
      actorId: session.user.id,
      actionType: 'seller_password_reset_by_admin',
      targetType: 'seller',
      targetId: seller.id,
      newData: { email: seller.user.email },
      ...(body.reason ? { note: body.reason } : {}),
    })

    return ok({ reset: true })
  } catch (err) {
    return handleError(err)
  }
}
