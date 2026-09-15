import { Prisma, type Payout } from '@prisma/client'
import { createHash } from 'node:crypto'

type FinanceReader = Pick<Prisma.TransactionClient, 'sellerLedgerEntry' | 'refundTransaction' | 'penalty'>
const zero = () => new Prisma.Decimal(0)

export function isPayoutSettled(status: string) {
  return status === 'payout_paid' || status === 'payout_offset'
}

/** Derived from original debt movements and immutable settlement links, never wallet balance. */
export async function outstandingPayoutDebts(tx: FinanceReader, sellerId: string) {
  const entries = await tx.sellerLedgerEntry.findMany({
    where: { sellerId, effectiveAt: { lte: new Date() }, type: { in: ['penalty', 'manual_adjustment', 'refund'] } },
    include: { debtOffsets: { select: { amount: true } } },
    orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  const refunds = await tx.refundTransaction.findMany({
    where: { sellerId, id: { in: entries.filter(e => e.type === 'refund' && e.referenceType === 'refund_transaction').map(e => e.referenceId) } },
    select: { id: true, sellerAdjustmentAmount: true, createdAt: true,
      order: { select: { payouts: { where: { sellerId }, select: { status: true, paidAt: true, settledAt: true } } } } },
  })
  const refundMap = new Map(refunds.map(refund => [refund.id, refund]))
  const credits = new Map<string, Prisma.Decimal>()
  for (const entry of entries) {
    if (entry.type !== 'manual_adjustment' || !entry.createdBy || !entry.amount.gt(0)) continue
    const key = `${entry.referenceType}:${entry.referenceId}`
    credits.set(key, (credits.get(key) ?? zero()).add(entry.amount))
  }
  // Older explicit penalty settlements predate the source-link table.
  const previousOffsets = await tx.penalty.findMany({
    where: { sellerId, status: 'offset', offsetPayoutId: { not: null } },
    select: { id: true, orderId: true, penaltyAmount: true },
  })
  for (const penalty of previousOffsets) {
    const source = entries.find(entry => entry.type === 'penalty' &&
      ((entry.referenceType === 'penalty' && entry.referenceId === penalty.id) ||
        (entry.referenceType === 'order' && entry.referenceId === penalty.orderId)))
    if (source && !entries.some(entry => entry.referenceType === source.referenceType &&
      entry.referenceId === source.referenceId && entry.debtOffsets.length > 0)) {
      const key = `${source.referenceType}:${source.referenceId}`
      credits.set(key, (credits.get(key) ?? zero()).add(penalty.penaltyAmount))
    }
  }
  const debts: { ledgerEntryId: string; remaining: Prisma.Decimal }[] = []
  for (const entry of entries) {
    if (!entry.amount.lt(0)) continue
    let principal = entry.amount.negated()
    if (entry.type === 'manual_adjustment' && !entry.createdBy) continue
    if (entry.type === 'refund') {
      const refund = refundMap.get(entry.referenceId)
      const closed = refund?.order.payouts.find(p => isPayoutSettled(p.status))
      const closedAt = closed?.settledAt ?? closed?.paidAt
      // Pre-settlement refunds already reduced this order's payout: never deduct twice.
      if (!refund || !closedAt || refund.createdAt < closedAt) continue
      principal = refund.sellerAdjustmentAmount
    }
    const key = `${entry.referenceType}:${entry.referenceId}`
    const applied = entry.debtOffsets.reduce((sum, offset) => sum.add(offset.amount), zero())
    principal = Prisma.Decimal.max(zero(), principal.sub(applied))
    const credit = Prisma.Decimal.min(principal, credits.get(key) ?? zero())
    credits.set(key, (credits.get(key) ?? zero()).sub(credit))
    const remaining = principal.sub(credit)
    if (remaining.gt(0)) debts.push({ ledgerEntryId: entry.id, remaining })
  }
  return debts
}

export async function previewPayoutOffset(tx: FinanceReader, payout: Payout, paymentSnapshot: string) {
  const debts = await outstandingPayoutDebts(tx, payout.sellerId)
  if (isPayoutSettled(payout.status)) return {
    allocations: [], offsetAmount: payout.offsetAmount,
    transferAmount: payout.netAmount.sub(payout.offsetAmount),
    remainingDebt: debts.reduce((sum, debt) => sum.add(debt.remaining), zero()),
    snapshot: paymentSnapshot,
  }
  let available = payout.netAmount
  const allocations: { ledgerEntryId: string; amount: Prisma.Decimal }[] = []
  for (const debt of debts) {
    const amount = Prisma.Decimal.min(available, debt.remaining)
    if (amount.gt(0)) allocations.push({ ledgerEntryId: debt.ledgerEntryId, amount })
    available = available.sub(amount)
  }
  const offsetAmount = payout.netAmount.sub(available)
  const remainingDebt = debts.reduce((sum, debt) => sum.add(debt.remaining), zero()).sub(offsetAmount)
  const snapshot = createHash('sha256').update(JSON.stringify({ paymentSnapshot,
    debts: debts.map(d => [d.ledgerEntryId, d.remaining.toFixed(2)]),
  })).digest('hex')
  return { allocations, offsetAmount, transferAmount: available, remainingDebt, snapshot }
}

export async function recordPayoutOffsets(tx: Prisma.TransactionClient, payoutId: string,
  allocations: { ledgerEntryId: string; amount: Prisma.Decimal }[]) {
  for (const allocation of allocations) {
    await tx.payoutDebtOffset.create({ data: { payoutId, ...allocation } })
  }
}

/** Batch forecast consumes each seller's outstanding debt once across its open members. */
export async function projectedBatchTransfer(tx: FinanceReader,
  rows: Pick<Payout, 'sellerId' | 'status' | 'netAmount' | 'offsetAmount'>[]) {
  let total = zero()
  const remaining = new Map<string, Prisma.Decimal>()
  for (const row of rows) {
    if (isPayoutSettled(row.status)) {
      total = total.add(row.netAmount.sub(row.offsetAmount))
      continue
    }
    if (!remaining.has(row.sellerId)) {
      const debts = await outstandingPayoutDebts(tx, row.sellerId)
      remaining.set(row.sellerId, debts.reduce((sum, debt) => sum.add(debt.remaining), zero()))
    }
    const debt = remaining.get(row.sellerId)!
    const offset = Prisma.Decimal.min(row.netAmount, debt)
    total = total.add(row.netAmount.sub(offset))
    remaining.set(row.sellerId, debt.sub(offset))
  }
  return total
}
