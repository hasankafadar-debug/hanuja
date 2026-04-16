/**
 * Fulfillment Risk Job — runs daily.
 * Finds orders approaching or past the 20-day fulfillment commitment.
 * Flags them for admin review — does NOT auto-cancel (requires human decision).
 *
 * See: penalty-calculator.ts FULFILLMENT_DAYS = 20
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createOrderRepository } from '../repositories/order.repository'
import { getFulfillmentDeadline, FULFILLMENT_DAYS } from '../domain/penalty-calculator'

export interface FulfillmentRiskJobData {
  warnAtDays?: number // Default: 17 (3 days before breach)
}

async function processFulfillmentRisk(job: Job<FulfillmentRiskJobData>) {
  const orderRepo = createOrderRepository(prisma)
  const warnAtDays = job.data.warnAtDays ?? 17

  // Find orders where payment_confirmed was more than warnAtDays ago
  const warnCutoff = new Date()
  warnCutoff.setDate(warnCutoff.getDate() - warnAtDays)

  const atRisk = await orderRepo.findAtFulfillmentRisk(warnCutoff)

  const now = new Date()
  let breached = 0
  let warning = 0

  for (const order of atRisk) {
    if (!order.paymentConfirmedAt) continue

    const deadline = getFulfillmentDeadline(order.paymentConfirmedAt)
    const isBreached = now > deadline
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (isBreached) {
      breached++
      // In production: create admin notification or risk flag
      console.warn(
        `[fulfillment-risk] BREACH: order ${order.id} — ${Math.abs(daysRemaining)} days overdue`,
      )
    } else {
      warning++
      console.log(
        `[fulfillment-risk] WARNING: order ${order.id} — ${daysRemaining} days remaining`,
      )
    }
  }

  console.log(`[fulfillment-risk] Breached: ${breached}, Warning: ${warning}`)
  return { breached, warning }
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
