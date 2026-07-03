/**
 * Fulfillment Risk Job - runs daily.
 * Refreshes admin-visible line-based risk records.
 *
 * Automatic seller warnings, daily penalty accrual, and auto-cancel are
 * intentionally disabled. Admin reviews the queue and applies any manual
 * penalty decision separately.
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createFulfillmentRiskService } from '../services/fulfillment-risk.service'

export interface FulfillmentRiskJobData {
  warnAtDays?: number
}

export async function processFulfillmentRisk(job: Job<FulfillmentRiskJobData>) {
  const asOf = new Date()
  const riskSvc = createFulfillmentRiskService({ prisma })
  const result = await riskSvc.refreshActiveRisks(asOf)

  console.log(
    `[fulfillment-risk] Breached: ${result.breached}, Warning: ${result.warning}, Resolved: ${result.resolved}`,
  )

  return {
    ...result,
    warnAtDays: job.data.warnAtDays ?? null,
  }
}

export function startFulfillmentRiskWorker() {
  const worker = new Worker<FulfillmentRiskJobData>(
    QUEUE_NAMES.FULFILLMENT_RISK,
    processFulfillmentRisk,
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[fulfillment-risk] Job ${job?.id} failed:`, err)
  })

  return worker
}
