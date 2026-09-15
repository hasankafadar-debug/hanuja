import type { PrismaClient, SellerInvoiceType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { lockSellerFinance } from '../lib/seller-finance-lock'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'

// Commission invoices carry 20% VAT; penalty invoices carry 0% VAT (default rates).
const DEFAULT_VAT_RATE: Record<SellerInvoiceType, Decimal> = {
  commission: new Decimal('0.2000'),
  penalty: new Decimal('0.0000'),
}

const ONE = new Decimal(1)

export function createSellerInvoiceService({ prisma }: { prisma: PrismaClient }) {
  const ledger = createSellerLedgerRepository(prisma)
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
      if (!vatRate.isFinite() || vatRate.lt(0) || vatRate.gt(1)) {
        throw new ValidationError('Geçersiz KDV oranı.')
      }

      // Resolve amounts: admin enters KDV-inclusive total, service derives net.
      let grossInvoiceAmount: Decimal
      let amount: Decimal
      let vatAmount: Decimal

      if (params.grossInvoiceAmount) {
        grossInvoiceAmount = params.grossInvoiceAmount
        amount = roundMoney(grossInvoiceAmount.div(ONE.plus(vatRate)))
        vatAmount = grossInvoiceAmount.minus(amount)
      } else if (params.amount) {
        amount = params.amount
        vatAmount = roundMoney(amount.mul(vatRate))
        grossInvoiceAmount = amount.plus(vatAmount)
      } else {
        throw new ValidationError('Either grossInvoiceAmount or amount must be provided.')
      }

      if (!grossInvoiceAmount.isFinite() || grossInvoiceAmount.decimalPlaces() > 2 || grossInvoiceAmount.lessThanOrEqualTo(0)) {
        throw new ValidationError('Invoice amount must be greater than zero.')
      }

      return prisma.$transaction(async (tx) => {
        await lockSellerFinance(tx, [params.sellerId])
        const seller = await tx.seller.findUnique({
          where: { id: params.sellerId },
          select: { id: true },
        })
        if (!seller) throw new NotFoundError('Seller', params.sellerId)

        let orderPublicNumber: number | null = null
        if (params.sourceOrderId) {
          const order = await tx.order.findUnique({
            where: { id: params.sourceOrderId },
            select: { id: true, publicNumber: true },
          })
          if (!order) throw new NotFoundError('Order', params.sourceOrderId)
          orderPublicNumber = order.publicNumber
        }

        if (params.sourcePenaltyId) {
          const penalty = await tx.penalty.findUnique({
            where: { id: params.sourcePenaltyId },
            select: { id: true, status: true, orderId: true, sellerId: true },
          })
          if (!penalty) throw new NotFoundError('Penalty', params.sourcePenaltyId)
          if (penalty.sellerId !== params.sellerId || (params.sourceOrderId && penalty.orderId !== params.sourceOrderId)) {
            throw new ValidationError('Ceza satıcı veya sipariş ile eşleşmiyor.')
          }
          if (penalty.status === 'waived') {
            throw new ValidationError('Waived penalties cannot be invoiced.')
          }
          if (!orderPublicNumber && penalty.orderId) {
            const order = await tx.order.findUnique({
              where: { id: penalty.orderId },
              select: { publicNumber: true },
            })
            orderPublicNumber = order?.publicNumber ?? null
          }
        }

        const duplicate = await tx.sellerInvoice.findUnique({
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
        let alreadyAccruedCommissionAmount = new Decimal(0)
        if (params.type === 'commission' && params.sourceOrderId) {
          const payouts = await tx.payout.findMany({
            where: { orderId: params.sourceOrderId, sellerId: params.sellerId },
            select: { id: true, commissionAmount: true },
          })
          linkedPayoutIds = payouts.map((p) => p.id)
          // Use the original debit, not the payout's refund-reduced commission.
          // Otherwise issuing an invoice after a refund charges the refunded VAT again.
          const accrued = await tx.sellerLedgerEntry.aggregate({
            where: { sellerId: params.sellerId, type: 'commission', amount: { lt: 0 },
              referenceType: 'payout', referenceId: { in: linkedPayoutIds } },
            _sum: { amount: true },
          })
          alreadyAccruedCommissionAmount = (accrued._sum.amount ?? new Decimal(0)).negated()
          const snapshot = await tx.orderLine.aggregate({
            where: { orderId: params.sourceOrderId, sellerId: params.sellerId, commissionExemptedAt: null },
            _sum: { commissionAmount: true },
          })
          alreadyAccruedCommissionAmount = Decimal.max(
            alreadyAccruedCommissionAmount, snapshot._sum.commissionAmount ?? 0,
          )

        }

        let lineCommission: Decimal | null = null
        if (params.sourceOrderLineId) {
          const line = await tx.orderLine.findUnique({ where: { id: params.sourceOrderLineId } })
          if (!line || line.sellerId !== params.sellerId || line.orderId !== params.sourceOrderId) {
            throw new ValidationError('Fatura satırı satıcı veya sipariş ile eşleşmiyor.')
          }
          if (line.commissionInvoiceId || line.commissionExemptedAt) {
            throw new ConflictError('Satır zaten faturalandırılmış veya komisyondan muaf.')
          }
          lineCommission = line.commissionAmount
        }
        if (params.payoutId) {
          const payout = await tx.payout.findUnique({ where: { id: params.payoutId } })
          if (!payout || payout.sellerId !== params.sellerId || payout.orderId !== params.sourceOrderId) {
            throw new ValidationError('Hakediş satıcı veya sipariş ile eşleşmiyor.')
          }
        }
        if (params.type === 'commission' && params.sourceOrderId) {
          const sellerLine = await tx.orderLine.findFirst({
            where: { orderId: params.sourceOrderId, sellerId: params.sellerId }, select: { id: true },
          })
          if (!sellerLine) throw new ValidationError('Sipariş bu satıcıya ait ürün içermiyor.')
        }
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
          const refunds = await tx.refundTransaction.findMany({
            where: { orderId: params.sourceOrderId, sellerId: params.sellerId }, select: { id: true },
          })
          await tx.sellerLedgerEntry.updateMany({
            where: {
              sellerId: params.sellerId,
              visibleToSeller: false,
              OR: [
                { type: 'commission' as const, referenceType: 'refund_transaction', referenceId: { in: refunds.map(r => r.id) } },
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
              type: { in: ['penalty', 'manual_adjustment'] },
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

        // Invoices describe an existing commission, including its VAT. For a
        // linked line use its own snapshot, never another line/seller's commission.
        // Historical VAT top-ups are counted once across all invoices of the order.
        let ledgerTopUpAmount = vatAmount
        if (params.type === 'commission' && params.sourceOrderId) {
          const previousInvoices = await tx.sellerInvoice.findMany({
            where: { sellerId: params.sellerId, type: 'commission', sourceOrderId: params.sourceOrderId,
              id: { not: invoice.id } }, select: { id: true, grossInvoiceAmount: true,
                orderLines: { where: { sellerId: params.sellerId }, select: { commissionAmount: true } },
              },
          })
          const previousTopUps = await tx.sellerLedgerEntry.aggregate({
            where: { sellerId: params.sellerId, type: 'commission_invoice_issued',
              referenceType: 'seller_invoice', referenceId: { in: previousInvoices.map(i => i.id) } },
            _sum: { amount: true },
          })
          // Order-wide invoices and individual line invoices can overlap. Charge
          // the larger required top-up, never their sum; subtract prior postings.
          let lineTopUp = lineCommission !== null
            ? Decimal.max(0, grossInvoiceAmount.minus(lineCommission)) : new Decimal(0)
          let orderTopUp = lineCommission === null
            ? Decimal.max(0, grossInvoiceAmount.minus(alreadyAccruedCommissionAmount)) : new Decimal(0)
          for (const previous of previousInvoices) {
            if (previous.orderLines.length) {
              const base = previous.orderLines.reduce((sum, line) => sum.plus(line.commissionAmount), new Decimal(0))
              lineTopUp = lineTopUp.plus(Decimal.max(0, previous.grossInvoiceAmount.minus(base)))
            } else {
              orderTopUp = Decimal.max(orderTopUp, previous.grossInvoiceAmount.minus(alreadyAccruedCommissionAmount))
            }
          }
          ledgerTopUpAmount = roundMoney(Decimal.max(lineTopUp, orderTopUp).plus(previousTopUps._sum.amount ?? 0))
        }
        const vatLedgerAmount = ledgerTopUpAmount.greaterThan(0)
          ? ledgerTopUpAmount.negated()
          : new Decimal(0)

        await ledger.createEntry(
          {
            sellerId: params.sellerId,
            type: ledgerEntryType,
            amount: vatLedgerAmount,
            eventKey: `seller-invoice:top-up:${invoice.id}`,
            effectiveAt: params.invoiceDate,
            referenceType: 'seller_invoice',
            referenceId: invoice.id,
            description: vatLineDescription,
            createdBy: params.createdByAdminId,
            visibleToSeller: true,
          },
          tx,
        )

        return invoice
      })
    },
  }
}

export type SellerInvoiceService = ReturnType<typeof createSellerInvoiceService>
