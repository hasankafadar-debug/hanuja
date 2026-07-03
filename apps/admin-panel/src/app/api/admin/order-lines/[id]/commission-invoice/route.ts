import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSellerInvoiceService } from '@hanuja/api/services/seller-invoice.service'

const bodySchema = z.object({
  invoiceNumber: z.string().trim().min(1),
  invoiceDate: z.string().datetime(),
  description: z.string().trim().optional(),
  // Admin enters the VAT-inclusive total; service derives net amount and VAT.
  grossInvoiceAmount: z.union([z.string(), z.number()]),
  sellerId: z.string().min(1),
  sourceOrderId: z.string().min(1),
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
        sellerId: true,
        orderId: true,
        commissionInvoiceId: true,
        commissionExemptedAt: true,
      },
    })
    if (!line) throw new NotFoundError('OrderLine', id)
    if (line.commissionInvoiceId) {
      throw new ValidationError('Bu satır zaten faturalandırılmış.')
    }
    if (line.commissionExemptedAt) {
      throw new ValidationError('Bu satır komisyondan muaf tutulmuş.')
    }
    if (line.sellerId !== body.sellerId || line.orderId !== body.sourceOrderId) {
      throw new ValidationError('Satıcı veya sipariş bilgileri satırla eşleşmiyor.')
    }

    const service = createSellerInvoiceService({ prisma })
    const invoice = await service.create({
      sellerId: body.sellerId,
      type: 'commission',
      invoiceNumber: body.invoiceNumber,
      invoiceDate: new Date(body.invoiceDate),
      grossInvoiceAmount: new Decimal(body.grossInvoiceAmount),
      sourceOrderId: body.sourceOrderId,
      sourceOrderLineId: id,
      createdByAdminId: session.user.id,
      ...(body.description ? { description: body.description } : {}),
    })

    return ok({ invoice })
  } catch (error) {
    return handleError(error)
  }
}
