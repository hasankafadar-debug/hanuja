import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { sellerApprovalTemplate } from '@hanuja/api/lib/email-templates/seller-approval'
import { sendEmail } from '@hanuja/api/lib/mailer'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { enqueueStoreSync } from '@hanuja/api/jobs/search-index-sync.job'
import { createAdminSellerActivationService } from '@hanuja/api/services/admin-seller-activation.service'

const bodySchema = z
  .object({
    status: z.enum(['active', 'suspended', 'rejected']),
    reason: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'suspended' && !value.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Askıya alma gerekçesi zorunludur.',
      })
    }
  })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = await req.json()
    const { status, reason } = bodySchema.parse(body)

    const prisma = createPrismaForRoute()
    const sellers = createSellerRepository(prisma)
    const auditLog = createAdminAuditLogRepository(prisma)
    const activationService = createAdminSellerActivationService({ prisma })

    const seller = await prisma.seller.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        user: { select: { email: true } },
      },
    })
    if (!seller) throw new NotFoundError('Seller', id)

    const affectedProducts = await prisma.product.count({
      where: { sellerId: id, status: 'published' },
    })
    const isInitialActivation =
      status === 'active' && (seller.status === 'pending' || seller.status === 'rejected')

    if (isInitialActivation) {
      await activationService.assertReady(id)

      await activationService.activateInitial({
        sellerId: id,
        adminActorId: session.user.id,
      })

      const template = sellerApprovalTemplate({
        email: seller.user.email,
        panelUrl: process.env.SELLER_PANEL_URL ?? 'http://localhost:3001',
      })
      await sendEmail({
        to: seller.user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }).catch((error) => {
        console.error('[seller-status] Approval email failed after activation', error)
      })
    } else {
      // Suspended seller reactivation intentionally keeps the existing lightweight
      // status-only behavior; onboarding checks apply only to pending/rejected sellers.
      await sellers.updateStatus(id, status)
    }

    const actionType =
      status === 'suspended'
        ? ('seller_suspended' as const)
        : status === 'rejected'
          ? ('seller_rejected' as const)
          : ('seller_activated' as const)

    if (!isInitialActivation) {
      await auditLog.createEntry({
        actorId: session.user.id,
        actionType,
        targetType: 'seller',
        targetId: id,
        previousData: { status: seller.status },
        newData: { status },
        ...(reason !== undefined ? { reason: reason.trim() } : {}),
      })
    }

    await enqueueStoreSync({
      entityId: id,
      operation: status === 'active' ? 'upsert' : 'delete',
    }).catch((error) => {
      console.error('[seller-status] Search sync enqueue failed', error)
    })

    return ok({ updated: true, status, affectedProducts })
  } catch (err) {
    return handleError(err)
  }
}
