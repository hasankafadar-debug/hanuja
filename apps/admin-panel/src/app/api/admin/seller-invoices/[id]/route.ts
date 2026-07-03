import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { Decimal } from '@prisma/client/runtime/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'

const updateSellerInvoiceSchema = z
  .object({
    invoiceDate: z.string().datetime().optional(),
    invoiceCategory: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    grossInvoiceAmount: z.union([z.string(), z.number()]).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    vatAmount: z.union([z.string(), z.number()]).optional(),
  })
  .refine(
    (data) =>
      data.invoiceDate !== undefined ||
      data.invoiceCategory !== undefined ||
      data.description !== undefined ||
      data.grossInvoiceAmount !== undefined ||
      data.amount !== undefined ||
      data.vatAmount !== undefined,
    { message: 'En az bir alan guncellenmeli.' },
  )

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id } = await params
    const body = updateSellerInvoiceSchema.parse(await req.json())
    const prisma = createPrismaForRoute()

    const current = await prisma.sellerInvoice.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        payoutId: true,
        invoiceNumber: true,
        invoiceDate: true,
        invoiceCategory: true,
        description: true,
        amount: true,
        vatRate: true,
        vatAmount: true,
        grossInvoiceAmount: true,
      },
    })

    if (!current) {
      throw new ValidationError('Fatura bulunamadi.')
    }
    if (current.payoutId) {
      throw new ValidationError('Payouta bagli faturalar duzenlenemez.')
    }

    let nextAmount = current.amount
    let nextVatAmount = current.vatAmount
    let nextGrossAmount = current.grossInvoiceAmount

    if (body.amount !== undefined) {
      nextAmount = new Decimal(body.amount)
    }
    if (body.vatAmount !== undefined) {
      nextVatAmount = new Decimal(body.vatAmount)
    }
    if (body.grossInvoiceAmount !== undefined) {
      nextGrossAmount = new Decimal(body.grossInvoiceAmount)
      if (body.amount === undefined && body.vatAmount === undefined) {
        nextAmount = nextGrossAmount.div(new Decimal(1).plus(current.vatRate)).toDecimalPlaces(2)
        nextVatAmount = nextGrossAmount.minus(nextAmount)
      }
    } else if (body.amount !== undefined || body.vatAmount !== undefined) {
      nextGrossAmount = nextAmount.plus(nextVatAmount)
    }

    if (nextGrossAmount.lessThanOrEqualTo(0)) {
      throw new ValidationError('Fatura tutari sifirdan buyuk olmalidir.')
    }

    const updated = await prisma.sellerInvoice.update({
      where: { id },
      data: {
        amount: nextAmount,
        vatAmount: nextVatAmount,
        grossInvoiceAmount: nextGrossAmount,
        ...(body.invoiceDate !== undefined ? { invoiceDate: new Date(body.invoiceDate) } : {}),
        ...(body.invoiceCategory !== undefined ? { invoiceCategory: body.invoiceCategory } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
    })

    console.info('[admin][seller-invoice.updated]', {
      actorId: session.user.id,
      invoiceId: id,
      previousValues: {
        invoiceDate: current.invoiceDate.toISOString(),
        invoiceCategory: current.invoiceCategory,
        description: current.description,
        amount: current.amount.toString(),
        vatAmount: current.vatAmount.toString(),
        grossInvoiceAmount: current.grossInvoiceAmount.toString(),
      },
      newValues: {
        invoiceDate: updated.invoiceDate.toISOString(),
        invoiceCategory: updated.invoiceCategory,
        description: updated.description,
        amount: updated.amount.toString(),
        vatAmount: updated.vatAmount.toString(),
        grossInvoiceAmount: updated.grossInvoiceAmount.toString(),
      },
    })

    return ok({ invoice: updated })
  } catch (error) {
    return handleError(error)
  }
}
