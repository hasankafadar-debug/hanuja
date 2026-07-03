import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'

const bodySchema = z.object({
  reason: z.string().trim().min(1),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = bodySchema.parse(await req.json())

    const prisma = createPrismaForRoute()

    const line = await prisma.orderLine.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        sellerId: true,
        commissionInvoiceId: true,
        commissionExemptedAt: true,
      },
    })
    if (!line) throw new NotFoundError('OrderLine', id)
    if (line.commissionInvoiceId) {
      throw new ValidationError('Bu satır zaten faturalandırılmış, muaf tutulamaz.')
    }
    if (line.commissionExemptedAt) {
      throw new ValidationError('Bu satır zaten muaf tutulmuş.')
    }

    // Once a payout snapshot exists for this order+seller, the commission has
    // already been locked into Payout.commissionAmount / netAmount. Exempting
    // afterward would silently diverge the payout from the ledger. Post-payout
    // compensation is intentionally out of scope — block it here.
    const existingPayout = await prisma.payout.findFirst({
      where: { orderId: line.orderId, sellerId: line.sellerId },
      select: { id: true },
    })
    if (existingPayout) {
      throw new ConflictError(
        'Hakediş kaydı oluşturulmuş siparişte komisyon muafiyeti uygulanamaz',
      )
    }

    // commissionExemptedBy / At / Reason serve as the audit trail; the OrderLine
    // itself becomes the durable record.
    const updated = await prisma.orderLine.update({
      where: { id },
      data: {
        commissionExemptedAt: new Date(),
        commissionExemptedBy: session.user.id,
        commissionExemptedReason: body.reason,
      },
    })

    return ok({ orderLine: updated })
  } catch (error) {
    return handleError(error)
  }
}
