/**
 * Payout Batch Job — groups 'ready' payouts into a PayoutBatch for admin review.
 * Does NOT auto-pay — creates a batch record for admin to process and approve.
 *
 * Batch payouts still respect 30-day order-level hold.
 * Admin must mark each payout as paid after processing.
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { Decimal } from '@prisma/client/runtime/client'

export interface PayoutBatchJobData {
  dryRun?: boolean
}

async function processPayoutBatch(job: Job<PayoutBatchJobData>) {
  // Find all ready payouts not yet assigned to a batch
  const readyPayouts = await prisma.payout.findMany({
    where: { status: 'payout_ready', batchId: null },
    include: { seller: true },
  })

  if (readyPayouts.length === 0) {
    console.log('[payout-batch] No ready payouts to batch')
    return { batchCreated: false }
  }

  if (job.data.dryRun) {
    console.log(`[payout-batch] DRY RUN: ${readyPayouts.length} payouts would be batched`)
    return { batchCreated: false, count: readyPayouts.length }
  }

  const totalAmount = readyPayouts.reduce(
    (sum, p) => sum.plus(p.netAmount),
    new Decimal(0),
  )

  const sellerIds = [...new Set(readyPayouts.map((p) => p.sellerId))]
  const reference = `BATCH-${Date.now()}`

  const batch = await prisma.$transaction(async (tx) => {
    const newBatch = await tx.payoutBatch.create({
      data: {
        reference,
        totalAmount,
        sellerCount: sellerIds.length,
        payoutCount: readyPayouts.length,
      },
    })

    // Assign payouts to batch — status stays 'ready' until admin marks paid
    await tx.payout.updateMany({
      where: { id: { in: readyPayouts.map((p) => p.id) } },
      data: { batchId: newBatch.id },
    })

    return newBatch
  })

  console.log(
    `[payout-batch] Created batch ${reference}: ${readyPayouts.length} payouts, ${totalAmount.toFixed(2)} TRY`,
  )
  return { batchCreated: true, batchId: batch.id, reference, payoutCount: readyPayouts.length }
}

export function startPayoutBatchWorker() {
  const worker = new Worker<PayoutBatchJobData>(
    QUEUE_NAMES.PAYOUT_BATCH,
    processPayoutBatch,
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[payout-batch] Job ${job?.id} failed:`, err)
  })

  return worker
}
