import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { UnauthorizedError, ForbiddenError, NotFoundError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { recordNotification } from '@hanuja/api/services/notification-outbox.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const DOC_TYPES = [
  'identity',
  'tax_certificate',
  'trade_registry',
  'signature_circular',
  'bank_statement',
  'contract',
  'other',
] as const

const bodySchema = z.object({
  requiredDocTypes: z.array(z.enum(DOC_TYPES)).min(1),
  note: z.string().optional(),
})

const LABELS: Record<(typeof DOC_TYPES)[number], string> = {
  identity: 'Kimlik Belgesi',
  tax_certificate: 'Vergi Levhası',
  trade_registry: 'Ticaret Sicil Gazetesi',
  signature_circular: 'İmza Sirküleri',
  bank_statement: 'Banka Hesap Belgesi',
  contract: 'Sözleşme',
  other: 'Diğer',
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = bodySchema.parse(await req.json())
    const prisma = createPrismaForRoute()

    const seller = await prisma.seller.findUnique({
      where: { id },
      select: {
        id: true,
        documentsRequestedAt: true,
        requiredDocumentTypes: true,
        userId: true,
        user: { select: { email: true } },
      },
    })
    if (!seller) throw new NotFoundError('Seller', id)

    await prisma.$transaction(async (tx) => {
      const requestedAt = new Date()
      await tx.seller.update({
        where: { id: seller.id }, data: { documentsRequestedAt: requestedAt, requiredDocumentTypes: body.requiredDocTypes },
      })
      const audit = await createAdminAuditLogRepository(tx).createEntry({
        actorId: session.user.id, actionType: 'seller_documents_requested', targetType: 'seller', targetId: seller.id,
        previousData: { documentsRequestedAt: seller.documentsRequestedAt },
        newData: { documentsRequestedAt: requestedAt.toISOString(), requiredDocTypes: body.requiredDocTypes },
        ...(body.note ? { note: body.note } : {}),
      })
      await recordNotification(tx, {
        eventKey: 'seller:' + seller.id + ':documents-requested:' + audit.id,
        userId: seller.userId, emailTo: seller.user.email, type: 'seller_documents_requested',
        title: 'Belgeleriniz talep edildi', body: 'Başvurunuz için istenen belgeleri yükleyin.',
        data: {
          email: seller.user.email, requiredDocTypes: body.requiredDocTypes.map((type) => LABELS[type]),
          ...(body.note ? { note: body.note } : {}),
        },
      })
    })

    return ok({ requested: true })
  } catch (err) {
    return handleError(err)
  }
}
