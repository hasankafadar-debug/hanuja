import { Prisma } from '@prisma/client'

/** Serialize totals for a batch shared by several independently locked sellers. */
export async function syncPayoutBatch(tx: Prisma.TransactionClient, batchId: string | null) {
  if (!batchId) return
  await tx.$queryRaw(Prisma.sql`SELECT id FROM payout_batches WHERE id = ${batchId} FOR UPDATE`)
  const rows = await tx.payout.findMany({
    where: { batchId, status: { in: ['payout_ready', 'payout_scheduled', 'payout_paid'] } },
    select: { sellerId: true, netAmount: true },
  })
  await tx.payoutBatch.update({
    where: { id: batchId },
    data: {
      totalAmount: rows.reduce((sum, row) => sum.add(row.netAmount), new Prisma.Decimal(0)),
      payoutCount: rows.length,
      sellerCount: new Set(rows.map((row) => row.sellerId)).size,
    },
  })
}
