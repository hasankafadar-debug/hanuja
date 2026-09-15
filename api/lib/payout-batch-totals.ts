import { Prisma } from '@prisma/client'
import { projectedBatchTransfer } from '../services/payout-debt.service'

/** Serialize totals for a batch shared by several independently locked sellers. */
export async function syncPayoutBatch(tx: Prisma.TransactionClient, batchId: string | null) {
  if (!batchId) return
  await tx.$queryRaw(Prisma.sql`SELECT id FROM payout_batches WHERE id = ${batchId} FOR UPDATE`)
  const rows = await tx.payout.findMany({
    where: { batchId, status: { in: ['payout_ready', 'payout_scheduled', 'payout_paid', 'payout_offset'] } },
    select: { sellerId: true, status: true, netAmount: true, offsetAmount: true },
  })
  await tx.payoutBatch.update({
    where: { id: batchId },
    data: {
      totalAmount: await projectedBatchTransfer(tx, rows),
      payoutCount: rows.length,
      sellerCount: new Set(rows.map((row) => row.sellerId)).size,
    },
  })
}

export async function syncSellerPayoutBatches(tx: Prisma.TransactionClient, sellerId: string) {
  const rows = await tx.payout.findMany({ where: { sellerId, batchId: { not: null } },
    select: { batchId: true }, distinct: ['batchId'], orderBy: { batchId: 'asc' } })
  for (const row of rows) await syncPayoutBatch(tx, row.batchId)
}
