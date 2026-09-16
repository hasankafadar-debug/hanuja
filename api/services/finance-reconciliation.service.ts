import { Prisma, type PrismaClient } from '@prisma/client'
import { calculateNetPayout } from '../domain/payout-calculator'

export interface FinanceFinding {
  code: string
  recordId: string
  expected: string
  actual: string
}

/** A consistent, database-enforced read-only snapshot. Never repairs historical data. */
export async function reconcileFinance(prisma: PrismaClient, sellerId?: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      const findings: FinanceFinding[] = []
      const zero = new Prisma.Decimal(0)
      const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.add(b), zero)
      const compare = (
        code: string,
        recordId: string,
        expected: Prisma.Decimal,
        actual: Prisma.Decimal,
      ) => {
        if (!expected.eq(actual))
          findings.push({
            code,
            recordId,
            expected: expected.toFixed(2),
            actual: actual.toFixed(2),
          })
      }
      const ledger = await tx.sellerLedgerEntry.findMany({
        where: sellerId ? { sellerId } : {},
      })
      const payouts = await tx.payout.findMany({
        where: sellerId ? { sellerId } : {},
        include: { debtOffsets: true },
      })
      const refunds = await tx.refundTransaction.findMany({
        where: sellerId ? { sellerId } : {},
        include: { items: true },
      })
      const payments = await tx.payment.findMany({
        where: sellerId ? { order: { lines: { some: { sellerId } } } } : {},
        include: { refundTransactions: { include: { items: true } } },
      })
      for (const payout of payouts) {
        compare(
          'payout_sale_ledger',
          payout.id,
          payout.grossAmount,
          sum(
            ledger
              .filter(
                (e) =>
                  e.sellerId === payout.sellerId &&
                  e.type === 'sale' &&
                  e.referenceType === 'order' &&
                  e.referenceId === payout.orderId,
              )
              .map((e) => e.amount),
          ),
        )
        const closedAt = payout.settledAt ?? payout.paidAt
        const appliedRefunds = refunds.filter(
          (r) =>
            r.orderId === payout.orderId &&
            r.sellerId === payout.sellerId &&
            r.payoutAppliedAt &&
            (!closedAt || r.createdAt < closedAt),
        )
        const refundIds = new Set(appliedRefunds.map((r) => r.id))
        compare(
          'payout_commission_ledger',
          payout.id,
          payout.commissionAmount.negated(),
          sum(
            ledger
              .filter(
                (e) =>
                  e.sellerId === payout.sellerId &&
                  e.type === 'commission' &&
                  ((e.referenceType === 'payout' && e.referenceId === payout.id) ||
                    (e.referenceType === 'refund_transaction' && refundIds.has(e.referenceId))),
              )
              .map((e) => e.amount),
          ),
        )
        compare(
          'payout_refund_records',
          payout.id,
          sum(appliedRefunds.map((r) => r.grossProductAmount)),
          payout.refundAmount,
        )
        compare(
          'payout_components',
          payout.id,
          Prisma.Decimal.max(zero, calculateNetPayout(payout)),
          payout.netAmount,
        )
        compare(
          'payout_offsets',
          payout.id,
          sum(payout.debtOffsets.map((o) => o.amount)),
          payout.offsetAmount,
        )
        const settled = ['payout_paid', 'payout_offset'].includes(payout.status)
        const transfer = settled ? payout.netAmount.sub(payout.offsetAmount) : zero
        compare(
          'payout_transfer_ledger',
          payout.id,
          transfer.negated(),
          sum(
            ledger
              .filter(
                (e) =>
                  e.sellerId === payout.sellerId &&
                  e.type === 'payout' &&
                  e.referenceType === 'payout' &&
                  e.referenceId === payout.id,
              )
              .map((e) => e.amount),
          ),
        )
        if (
          payout.offsetAmount.lt(0) ||
          payout.offsetAmount.gt(payout.netAmount) ||
          (payout.status === 'payout_offset' && !transfer.eq(0))
        ) {
          findings.push({
            code: 'invalid_offset',
            recordId: payout.id,
            expected: '0 <= offset <= net; offset closure transfer = 0',
            actual: payout.offsetAmount.toFixed(2),
          })
        }
        for (const offset of payout.debtOffsets) {
          const source = ledger.find((e) => e.id === offset.ledgerEntryId)
          if (
            !source ||
            source.sellerId !== payout.sellerId ||
            !source.amount.lt(0) ||
            !offset.amount.gt(0) ||
            !settled
          ) {
            findings.push({
              code: 'invalid_offset_source',
              recordId: offset.id,
              expected: 'same seller debit and settled payout',
              actual: offset.ledgerEntryId,
            })
          }
        }
      }
      for (const entry of ledger) {
        const allocated = sum(
          payouts.flatMap((p) =>
            p.debtOffsets.filter((o) => o.ledgerEntryId === entry.id).map((o) => o.amount),
          ),
        )
        const refund =
          entry.referenceType === 'refund_transaction'
            ? refunds.find((r) => r.id === entry.referenceId)
            : undefined
        const principal =
          refund && entry.type === 'refund' ? refund.sellerAdjustmentAmount : entry.amount.negated()
        if (allocated.gt(Prisma.Decimal.max(zero, principal))) {
          findings.push({
            code: 'debt_overallocated',
            recordId: entry.id,
            expected: principal.toFixed(2),
            actual: allocated.toFixed(2),
          })
        }
      }
      for (const refund of refunds) {
        const entries = ledger.filter(
          (e) =>
            e.referenceType === 'refund_transaction' &&
            e.referenceId === refund.id &&
            e.sellerId === refund.sellerId,
        )
        compare(
          'refund_product_ledger',
          refund.id,
          refund.ledgerAppliedAt ? refund.grossProductAmount.negated() : zero,
          sum(entries.filter((e) => e.type === 'refund').map((e) => e.amount)),
        )
        compare(
          'refund_coupon_ledger',
          refund.id,
          refund.ledgerAppliedAt ? refund.couponAdjustmentAmount : zero,
          sum(entries.filter((e) => e.type === 'coupon_share').map((e) => e.amount)),
        )
        if (refund.status !== 'manual_required' || refund.items.length > 0) {
          compare(
            'refund_item_total',
            refund.id,
            refund.customerAmount,
            sum(refund.items.map((i) => i.amount)),
          )
        }
        if (refund.failureReason?.startsWith('Eski sipariş finansal incelemesi:')) {
          findings.push({
            code: 'unresolved_legacy_review',
            recordId: refund.id,
            expected: 'verified financial evidence',
            actual: refund.failureReason,
          })
        }
      }
      for (const payment of payments) {
        const completed = sum(
          payment.refundTransactions.flatMap((r) =>
            r.items.filter((i) => i.status === 'completed').map((i) => i.amount),
          ),
        )
        compare('payment_refunded_items', payment.id, completed, payment.refundedAmount)
        const reserved = sum(payment.refundTransactions.map((r) => r.customerAmount))
        if (
          reserved.gt(payment.amount) ||
          payment.refundedAmount.gt(payment.amount) ||
          payment.refundedAmount.lt(0)
        ) {
          findings.push({
            code: 'payment_refund_cap',
            recordId: payment.id,
            expected: payment.amount.toFixed(2),
            actual: Prisma.Decimal.max(reserved, payment.refundedAmount).toFixed(2),
          })
        }
      }
      return {
        checkedAt: new Date().toISOString(),
        scope: sellerId ?? 'all',
        counts: {
          ledger: ledger.length,
          payouts: payouts.length,
          refunds: refunds.length,
          payments: payments.length,
        },
        findings,
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60_000,
    },
  )
}
