import type { PrismaClient, SellerInvoiceType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'

export function createSellerInvoiceService({ prisma }: { prisma: PrismaClient }) {
  return {
    async create(params: {
      sellerId: string
      type: SellerInvoiceType
      invoiceNumber: string
      invoiceDate: Date
      invoiceCategory?: string | null
      description?: string | null
      amount: Decimal
      sourceOrderId?: string
      sourcePenaltyId?: string
      payoutId?: string
      createdByAdminId: string
    }) {
      const invoiceNumber = params.invoiceNumber.trim()
      if (!invoiceNumber) {
        throw new ValidationError('Invoice number is required.')
      }

      if (params.amount.lessThanOrEqualTo(0)) {
        throw new ValidationError('Invoice amount must be greater than zero.')
      }

      const seller = await prisma.seller.findUnique({
        where: { id: params.sellerId },
        select: { id: true },
      })
      if (!seller) throw new NotFoundError('Seller', params.sellerId)

      if (params.sourceOrderId) {
        const order = await prisma.order.findUnique({
          where: { id: params.sourceOrderId },
          select: { id: true },
        })
        if (!order) throw new NotFoundError('Order', params.sourceOrderId)
      }

      if (params.sourcePenaltyId) {
        const penalty = await prisma.penalty.findUnique({
          where: { id: params.sourcePenaltyId },
          select: { id: true, status: true },
        })
        if (!penalty) throw new NotFoundError('Penalty', params.sourcePenaltyId)
        if (penalty.status === 'waived') {
          throw new ValidationError('Waived penalties cannot be invoiced.')
        }
      }

      const duplicate = await prisma.sellerInvoice.findUnique({
        where: { invoiceNumber },
        select: { id: true },
      })
      if (duplicate) {
        throw new ConflictError(`This invoice number is already in use: ${invoiceNumber}`)
      }

      return prisma.sellerInvoice.create({
        data: {
          sellerId: params.sellerId,
          type: params.type,
          invoiceNumber,
          invoiceDate: params.invoiceDate,
          amount: params.amount,
          createdByAdminId: params.createdByAdminId,
          ...(params.invoiceCategory !== undefined ? { invoiceCategory: params.invoiceCategory } : {}),
          ...(params.description !== undefined ? { description: params.description } : {}),
          ...(params.sourceOrderId !== undefined ? { sourceOrderId: params.sourceOrderId } : {}),
          ...(params.sourcePenaltyId !== undefined ? { sourcePenaltyId: params.sourcePenaltyId } : {}),
          ...(params.payoutId !== undefined ? { payoutId: params.payoutId } : {}),
        },
      })
    },
  }
}

export type SellerInvoiceService = ReturnType<typeof createSellerInvoiceService>
