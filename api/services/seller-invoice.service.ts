import type { PrismaClient, SellerInvoiceType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'
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
        amount = roundMoney(grossInvoiceAmount.div(ONE.plus(vatRate)))
        vatAmount = grossInvoiceAmount.minus(amount)
      } else if (params.amount) {
        amount = params.amount
        vatAmount = roundMoney(amount.mul(vatRate))
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
      let alreadyAccruedCommissionAmount = new Decimal(0)
      if (params.type === 'commission' && params.sourceOrderId) {
        const payouts = await prisma.payout.findMany({
          where: { orderId: params.sourceOrderId },
          select: { id: true, commissionAmount: true },
        })
        linkedPayoutIds = payouts.map((p) => p.id)
        // KDV çifte-ekleme kontrolü (07-marketplace-finance-rules.md — komisyon
        // tabanı KDV dahil): commissionVatRate cutover'ından (2026-07-09) sonra
        // oluşturulan siparişlerde Payout.commissionAmount / OrderLine.commissionAmount
        // ARTIK KDV DAHİL — accrual anında (payout.service.activateHold) yazılan
        // `commission` ledger entry zaten tam KDV'li tutarı içerir. Cutover
        // öncesi (tarihi) siparişlerde ise bu tutar KDV'siz (net) idi ve KDV
        // ayrıca bu fatura akışında eklenirdi. Aşağıdaki `alreadyAccruedCommissionAmount`
        // her iki rejimde de doğru sonuç verir çünkü ledger'a yazılacak tutar
        // grossInvoiceAmount'tan bu değer düşülerek (residual/top-up yöntemi)
        // hesaplanır — accrual'da KDV dahil yazılmışsa top-up ~0'a yakın çıkar,
        // KDV'siz yazılmışsa top-up tam KDV payını tamamlar. Böylece iki adımın
        // (accrual + fatura) toplamı her zaman grossInvoiceAmount'a eşitlenir,
        // KDV asla iki kez eklenmez.
        alreadyAccruedCommissionAmount = payouts.reduce(
          (sum, p) => sum.plus(p.commissionAmount),
          new Decimal(0),
        )
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

        // Ledger top-up entry — debits the seller for whatever portion of
        // grossInvoiceAmount was NOT already debited at accrual time (residual
        // / "top-up" method, not a blind vatAmount debit — see the KDV
        // double-counting comment above `alreadyAccruedCommissionAmount`).
        //
        // - Commission invoices WITH a sourceOrderId: ledgerTopUp = grossInvoiceAmount
        //   − alreadyAccruedCommissionAmount. Post-cutover orders already accrued
        //   the full KDV-inclusive commission at payout.activateHold time, so this
        //   is ~0 (no double VAT debit). Pre-cutover (historical) orders accrued
        //   only the KDV-exclusive net, so this correctly resolves to the VAT
        //   portion — unchanged behavior for historical records.
        // - Commission invoices WITHOUT a sourceOrderId (ad-hoc) and all penalty
        //   invoices: nothing was accrued elsewhere for this invoice, so the
        //   pre-existing vatAmount-only debit is preserved (0 for penalties by
        //   default, per DEFAULT_VAT_RATE).
        const previousBalanceAgg = await tx.sellerLedgerEntry.aggregate({
          where: { sellerId: params.sellerId },
          _sum: { amount: true },
        })
        const previousBalance = previousBalanceAgg._sum.amount ?? new Decimal(0)
        const ledgerTopUpAmount =
          params.type === 'commission' && params.sourceOrderId
            ? roundMoney(grossInvoiceAmount.minus(alreadyAccruedCommissionAmount))
            : vatAmount
        const vatLedgerAmount = ledgerTopUpAmount.greaterThan(0)
          ? ledgerTopUpAmount.negated()
          : new Decimal(0)
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
