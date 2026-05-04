import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { sellerApprovalTemplate } from '@hanuja/api/lib/email-templates/seller-approval'
import { sendEmail } from '@hanuja/api/lib/mailer'

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

    const seller = await prisma.seller.findUnique({
      where: { id },
      include: {
        user: { select: { email: true } },
        bankDetails: { where: { isActive: true }, take: 1 },
      },
    })
    if (!seller) throw new NotFoundError('Seller', id)

    if (status === 'active') {
      const approvedDocs = await prisma.sellerDocument.findMany({
        where: { sellerId: id, status: 'approved' },
        select: { type: true },
      })

      const approvedDocTypes = new Set(approvedDocs.map((doc) => doc.type))
      const requiredDocTypes = ['identity', 'tax_certificate', 'bank_statement']

      if (!requiredDocTypes.every((docType) => approvedDocTypes.has(docType as never))) {
        return new Response(
          JSON.stringify({
            message: 'Satıcıyı aktifleştirmek için kimlik, vergi ve banka belgeleri onaylanmış olmalı.',
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const tempPassword = randomBytes(9).toString('base64url')

        await auth.api.admin.setUserPassword({
          headers: await headers(),
          body: { userId: seller.userId, newPassword: tempPassword },
        })

      await prisma.user.update({
        where: { id: seller.userId },
        data: { mustChangePassword: true },
      })

      const activeBankDetail = seller.bankDetails[0] ?? null

      if (activeBankDetail && approvedDocTypes.has('bank_statement')) {
        await prisma.sellerBankDetail.update({
          where: { id: activeBankDetail.id },
          data: {
            isVerified: true,
            isActive: true,
            verifiedAt: new Date(),
            activatedAt: new Date(),
          },
        })
      }

      await sellers.updateStatus(id, status)

      const template = sellerApprovalTemplate({
        email: seller.user.email,
        panelUrl: process.env.SELLER_PANEL_URL ?? 'http://localhost:3001',
        tempPassword,
      })

      await sendEmail({
        to: seller.user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      })
    } else {
      await sellers.updateStatus(id, status)
    }

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
