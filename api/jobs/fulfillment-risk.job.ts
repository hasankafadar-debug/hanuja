/**
 * Fulfillment Risk Job - runs daily.
 * Finds orders approaching or past the fulfillment commitment and persists them
 * for admin follow-up. It does not auto-cancel orders.
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createFulfillmentRiskService } from '../services/fulfillment-risk.service'

export interface FulfillmentRiskJobData {
  warnAtDays?: number
}

async function processFulfillmentRisk(job: Job<FulfillmentRiskJobData>) {
  const svc = createFulfillmentRiskService({ prisma })
  const result = await svc.refreshActiveRisks()
  console.log(
    `[fulfillment-risk] Breached: ${result.breached}, Warning: ${result.warning}, Resolved: ${result.resolved}`,
  )
  return { ...result, warnAtDays: job.data.warnAtDays ?? null }
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
