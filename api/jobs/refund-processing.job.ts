import { Job, Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES, refundProcessingQueue } from '../lib/queue'
import { createRefundExecutionService } from '../services/refund-execution.service'

export interface RefundProcessingJobData {
  refundTransactionId: string
}

export async function processRefundTransaction(job: Job<RefundProcessingJobData>) {
  // Keep the shared Prisma client lazy so importing the enqueue helper has no
  // database side effects in API routes, scripts, or isolated tests.
  const { prisma } = await import('../lib/prisma')
  return createRefundExecutionService({ prisma }).process(job.data.refundTransactionId)
}

export function startRefundProcessingWorker() {
  const worker = new Worker<RefundProcessingJobData>(
    QUEUE_NAMES.REFUND_PROCESSING,
    processRefundTransaction,
    { connection: redis, concurrency: 1 },
  )
  worker.on('failed', (job, error) => {
    console.error(`[refund-processing] Job ${job?.id} failed:`, error)
  })
  return worker
}

export function enqueueRefundProcessing(refundTransactionId: string) {
  return refundProcessingQueue.add(
    'process-refund',
    { refundTransactionId },
    {
      jobId: `refund-${refundTransactionId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  )
}
