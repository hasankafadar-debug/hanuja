import type { PrismaClient, SellerInvoiceType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'

// Commission invoices carry 20% VAT; penalty invoices carry 0% VAT (default rates).
const DEFAULT_VAT_RATE: Record<SellerInvoiceType, Decimal> = {
  commission: new Decimal('0.2000'),
  penalty: new Decimal('0.0000'),
}

const ONE = new Decimal(1)

export function createSellerInvoiceService({ prisma }: { prisma: PrismaClient }) {
  return {
    async create(params: {
      sellerId: string
      type: SellerInvoiceType
      invoiceNumber: string
      invoiceDate: Date
      invoiceCategory?: string | null
      description?: string | null
      /**
       * Admin enters the VAT-inclusive total in the UI. If provided, the
       * service derives the net `amount` and `vatAmount` from this value.
       */
      grossInvoiceAmount?: Decimal
      /**
       * Backwards-compatible net (VAT-exclusive) amount. If both `amount` and
       * `grossInvoiceAmount` are provided, `grossInvoiceAmount` wins.
       */
      amount?: Decimal
      vatRate?: Decimal // Belirtilmezse type'a göre DEFAULT_VAT_RATE kullanılır
      sourceOrderId?: string
      sourcePenaltyId?: string
      sourceOrderLineId?: string
      payoutId?: string
      createdByAdminId: string
    }) {
      const invoiceNumber = params.invoiceNumber.trim()
      if (!invoiceNumber) {
        throw new ValidationError('Invoice number is required.')
      }

      const vatRate = params.vatRate ?? DEFAULT_VAT_RATE[params.type]

      // Resolve amounts: admin enters KDV-inclusive total, service derives net.
      let grossInvoiceAmount: Decimal
      let amount: Decimal
      let vatAmount: Decimal

      if (params.grossInvoiceAmount) {
        grossInvoiceAmount = params.grossInvoiceAmount
        amount = grossInvoiceAmount.div(ONE.plus(vatRate)).toDecimalPlaces(2)
        vatAmount = grossInvoiceAmount.minus(amount)
      } else if (params.amount) {
        amount = params.amount
        vatAmount = amount.mul(vatRate).toDecimalPlaces(2)
        grossInvoiceAmount = amount.plus(vatAmount)
      } else {
        throw new ValidationError('Either grossInvoiceAmount or amount must be provided.')
      }

      if (grossInvoiceAmount.lessThanOrEqualTo(0)) {
        throw new ValidationError('Invoice amount must be greater than zero.')
      }

      const seller = await prisma.seller.findUnique({
        where: { id: params.sellerId },
        select: { id: true },
      })
      if (!seller) throw new NotFoundError('Seller', params.sellerId)

      let orderPublicNumber: number | null = null
      if (params.sourceOrderId) {
        const order = await prisma.order.findUnique({
          where: { id: params.sourceOrderId },
          select: { id: true, publicNumber: true },
        })
        if (!order) throw new NotFoundError('Order', params.sourceOrderId)
        orderPublicNumber = order.publicNumber
      }

      if (params.sourcePenaltyId) {
        const penalty = await prisma.penalty.findUnique({
          where: { id: params.sourcePenaltyId },
          select: { id: true, status: true, orderId: true },
        })
        if (!penalty) throw new NotFoundError('Penalty', params.sourcePenaltyId)
        if (penalty.status === 'waived') {
          throw new ValidationError('Waived penalties cannot be invoiced.')
        }
        if (!orderPublicNumber && penalty.orderId) {
          const order = await prisma.order.findUnique({
            where: { id: penalty.orderId },
            select: { publicNumber: true },
          })
          orderPublicNumber = order?.publicNumber ?? null
        }
      }

      const duplicate = await prisma.sellerInvoice.findUnique({
        where: { invoiceNumber },
        select: { id: true },
      })
      if (duplicate) {
        throw new ConflictError(`This invoice number is already in use: ${invoiceNumber}`)
      }

      const ledgerEntryType =
        params.type === 'commission' ? 'commission_invoice_issued' : 'penalty_invoice_issued'

      const orderLabel = orderPublicNumber !== null ? `#${orderPublicNumber}` : null
      const typeLabel = params.type === 'commission' ? 'Komisyon' : 'Ceza'
      const vatPctLabel = vatRate.mul(100).toDecimalPlaces(0).toString()
      const vatLineDescription = orderLabel
        ? `${typeLabel} faturası #${invoiceNumber} KDV (%${vatPctLabel}) — Sipariş ${orderLabel}`
        : `${typeLabel} faturası #${invoiceNumber} KDV (%${vatPctLabel})`

      // Resolve payout IDs that correspond to the source order so we can unhide
      // commission accrual entries (which reference payoutId, not orderId).
      let linkedPayoutIds: string[] = []
      if (params.type === 'commission' && params.sourceOrderId) {
        const payouts = await prisma.payout.findMany({
          where: { orderId: params.sourceOrderId },
          select: { id: true },
        })
        linkedPayoutIds = payouts.map((p) => p.id)
      }

      return prisma.$transaction(async (tx) => {
        const invoice = await tx.sellerInvoice.create({
          data: {
            sellerId: params.sellerId,
            type: params.type,
            invoiceNumber,
            invoiceDate: params.invoiceDate,
            amount,
            vatRate,
            vatAmount,
            grossInvoiceAmount,
            createdByAdminId: params.createdByAdminId,
            ...(params.invoiceCategory !== undefined ? { invoiceCategory: params.invoiceCategory } : {}),
            ...(params.description !== undefined ? { description: params.description } : {}),
            ...(params.sourceOrderId !== undefined ? { sourceOrderId: params.sourceOrderId } : {}),
            ...(params.sourcePenaltyId !== undefined ? { sourcePenaltyId: params.sourcePenaltyId } : {}),
            ...(params.payoutId !== undefined ? { payoutId: params.payoutId } : {}),
          },
        })

        // Reveal accrual entries linked to this invoice so they appear in the
        // seller statement. The net (VAT-exclusive) economic balance was already
        // debited at order / penalty time — invoice issuance only unhides those
        // entries. The VAT component is debited below as a separate ledger row.
        if (params.type === 'commission' && params.sourceOrderId) {
          await tx.sellerLedgerEntry.updateMany({
            where: {
              sellerId: params.sellerId,
              visibleToSeller: false,
              OR: [
                ...(linkedPayoutIds.length > 0
                  ? [{ type: 'commission' as const, referenceType: 'payout', referenceId: { in: linkedPayoutIds } }]
                  : []),
                { type: 'sale' as const, referenceType: 'order', referenceId: params.sourceOrderId },
              ],
            },
            data: { visibleToSeller: true },
          })
        }

        if (params.type === 'penalty' && params.sourcePenaltyId) {
          await tx.sellerLedgerEntry.updateMany({
            where: {
              sellerId: params.sellerId,
              visibleToSeller: false,
              type: 'penalty',
              referenceType: 'penalty',
              referenceId: params.sourcePenaltyId,
            },
            data: { visibleToSeller: true },
          })
        }

        // Link order line to invoice if provided (commission per OrderLine)
        if (params.sourceOrderLineId && params.type === 'commission') {
          await tx.orderLine.update({
            where: { id: params.sourceOrderLineId },
            data: { commissionInvoiceId: invoice.id },
          })
        }

        // VAT ledger entry — debits the seller for the VAT portion of the
        // invoice. Net commission/penalty was already debited at accrual time
        // (and just made visible above). VAT amount is 0 for penalty invoices.
        const previousBalanceAgg = await tx.sellerLedgerEntry.aggregate({
          where: { sellerId: params.sellerId },
          _sum: { amount: true },
        })
        const previousBalance = previousBalanceAgg._sum.amount ?? new Decimal(0)
        const vatLedgerAmount = vatAmount.greaterThan(0) ? vatAmount.negated() : new Decimal(0)
        const balanceAfter = previousBalance.plus(vatLedgerAmount)

        await tx.sellerLedgerEntry.create({
          data: {
            sellerId: params.sellerId,
            type: ledgerEntryType,
            amount: vatLedgerAmount,
            balanceAfter,
            referenceType: 'seller_invoice',
            referenceId: invoice.id,
            description: vatLineDescription,
            createdBy: params.createdByAdminId,
            visibleToSeller: true,
          },
        })

        return invoice
      })
    },
  }
}

export type SellerInvoiceService = ReturnType<typeof createSellerInvoiceService>
