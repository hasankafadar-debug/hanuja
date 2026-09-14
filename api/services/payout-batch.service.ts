import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { lockSellerFinance } from '../lib/seller-finance-lock'
import { lockPayoutEligibility, readPayoutEligibility } from './payout-eligibility'

export async function createReadyPayoutBatch(prisma: PrismaClient, dryRun = false) {
  const candidates = await prisma.payout.findMany({
    where: { status: 'payout_ready', batchId: null }, select: { id: true, sellerId: true },
  })
  return prisma.$transaction(async (tx) => {
    await lockSellerFinance(tx, candidates.map((p) => p.sellerId))
    const current = await tx.payout.findMany({
      where: { id: { in: candidates.map((p) => p.id) }, status: 'payout_ready', batchId: null },
      orderBy: [{ sellerId: 'asc' }, { orderId: 'asc' }],
    })
    const ready = []
    for (const payout of current) {
      await lockPayoutEligibility(tx, payout)
      const check = await readPayoutEligibility(tx, payout)
      if (check.ready) ready.push(payout)
      else if (!dryRun) await tx.payout.update({ where: { id: payout.id }, data: {
        status: check.manualReason || check.holdExpired ? 'payout_blocked' : 'hold_active',
        automaticBlockReason: check.automaticReason, blockedReason: check.reason,
      } })
    }
    if (dryRun || ready.length === 0) return { batchCreated: false, count: ready.length }
    const reference = `BATCH-${randomUUID()}`
    const batch = await tx.payoutBatch.create({ data: {
      reference, totalAmount: ready.reduce((sum, p) => sum.add(p.netAmount), new Decimal(0)),
      sellerCount: new Set(ready.map((p) => p.sellerId)).size, payoutCount: ready.length,
    } })
    await tx.payout.updateMany({
      where: { id: { in: ready.map((p) => p.id) }, batchId: null, status: 'payout_ready' },
      data: { batchId: batch.id },
    })
    return { batchCreated: true, batchId: batch.id, reference, payoutCount: ready.length }
  }, { timeout: 30_000 })
}
