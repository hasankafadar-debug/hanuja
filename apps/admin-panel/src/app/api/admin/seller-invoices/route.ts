import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createSellerInvoiceService } from '@hanuja/api/services/seller-invoice.service'
import { Decimal } from '@prisma/client/runtime/client'

const invoiceAmountInput = z.union([
  z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/),
  z.number().finite().nonnegative().max(9999999999.99),
])

const createSellerInvoiceSchema = z
  .object({
    sellerId: z.string().min(1),
    // Commission is deducted in the purchase invoice. Additional invoices are
    // separate gross-total debts; penalty invoices document an existing debt.
    type: z.enum(['penalty', 'additional']),
    invoiceNumber: z.string().trim().min(1).max(120),
    invoiceDate: z.string().datetime(),
    invoiceCategory: z.string().trim().max(120).optional(),
    description: z.string().trim().max(5000).optional(),
    // Admin may provide either VAT-inclusive total (preferred) or net amount.
    grossInvoiceAmount: invoiceAmountInput.optional(),
    amount: invoiceAmountInput.optional(),
    sourceOrderId: z.string().optional(),
    sourcePenaltyId: z.string().optional(),
    payoutId: z.string().optional(),
  })
  .refine((d) => d.grossInvoiceAmount !== undefined || d.amount !== undefined, {
    message: 'Either grossInvoiceAmount or amount must be provided.',
  })
  .superRefine((data, ctx) => {
    if (data.type === 'additional' && (!data.description || data.grossInvoiceAmount === undefined ||
      data.sourcePenaltyId || data.sourceOrderId || data.payoutId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ek fatura için açıklama ve KDV dahil toplam gerekli; ceza veya hakediş bağlantısı kullanılamaz.' })
    }
    if (data.type === 'penalty' && !data.sourcePenaltyId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ceza faturası mevcut bir ceza kaydına bağlanmalı.' })
    }
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
