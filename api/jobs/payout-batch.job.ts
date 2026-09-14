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
import { createReadyPayoutBatch } from '../services/payout-batch.service'

export interface PayoutBatchJobData {
  dryRun?: boolean
}

async function processPayoutBatch(job: Job<PayoutBatchJobData>) {
  return createReadyPayoutBatch(prisma, job.data.dryRun)
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
