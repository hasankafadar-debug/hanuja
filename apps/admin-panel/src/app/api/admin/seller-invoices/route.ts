import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSellerInvoiceService } from '@hanuja/api/services/seller-invoice.service'
import { Decimal } from '@prisma/client/runtime/client'

const createSellerInvoiceSchema = z
  .object({
    sellerId: z.string().min(1),
    type: z.enum(['commission', 'penalty']),
    invoiceNumber: z.string().trim().min(1),
    invoiceDate: z.string().datetime(),
    invoiceCategory: z.string().trim().optional(),
    description: z.string().trim().optional(),
    // Admin may provide either VAT-inclusive total (preferred) or net amount.
    grossInvoiceAmount: z.union([z.string(), z.number()]).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    sourceOrderId: z.string().optional(),
    sourcePenaltyId: z.string().optional(),
    payoutId: z.string().optional(),
  })
  .refine((d) => d.grossInvoiceAmount !== undefined || d.amount !== undefined, {
    message: 'Either grossInvoiceAmount or amount must be provided.',
  })

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const body = createSellerInvoiceSchema.parse(await req.json())
    const service = createSellerInvoiceService({ prisma: createPrismaForRoute() })

    const invoice = await service.create({
      sellerId: body.sellerId,
      type: body.type,
      invoiceNumber: body.invoiceNumber,
      invoiceDate: new Date(body.invoiceDate),
      ...(body.grossInvoiceAmount !== undefined
        ? { grossInvoiceAmount: new Decimal(body.grossInvoiceAmount) }
        : { amount: new Decimal(body.amount!) }),
      createdByAdminId: session.user.id,
      ...(body.invoiceCategory !== undefined ? { invoiceCategory: body.invoiceCategory || null } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.sourceOrderId !== undefined ? { sourceOrderId: body.sourceOrderId } : {}),
      ...(body.sourcePenaltyId !== undefined ? { sourcePenaltyId: body.sourcePenaltyId } : {}),
      ...(body.payoutId !== undefined ? { payoutId: body.payoutId } : {}),
    })

    return ok({ invoice })
  } catch (error) {
    return handleError(error)
  }
}
