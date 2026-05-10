/**
 * Fulfillment Risk Job - runs daily.
 * Refreshes admin-visible risk records, accrues late-shipment penalties, and
 * auto-cancels orders once the breach reaches day 20.
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createFulfillmentRiskService } from '../services/fulfillment-risk.service'
import { createPenaltyService } from '../services/penalty.service'
import { createOrderService } from '../services/order.service'

export interface FulfillmentRiskJobData {
  warnAtDays?: number
}

export async function processFulfillmentRisk(job: Job<FulfillmentRiskJobData>) {
  const asOf = new Date()
  const riskSvc = createFulfillmentRiskService({ prisma })
  const penaltySvc = createPenaltyService({ prisma })
  const orderSvc = createOrderService({ prisma })

  const result = await riskSvc.refreshActiveRisks(asOf)
  const breachedRisks = await prisma.fulfillmentRisk.findMany({
    where: { status: 'breached' },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          lines: {
            select: { sellerId: true },
            take: 1,
          },
        },
      },
    },
  })

  let accrued = 0
  let autoCancelled = 0

  for (const risk of breachedRisks) {
    const sellerId = risk.order.lines[0]?.sellerId
    if (!sellerId) continue

    const penalty = await penaltySvc.accrueDailyLateShipment({
      orderId: risk.orderId,
      asOf,
    })
    if (!penalty) continue

    accrued += 1

    if ((penalty.accrualDayCount ?? 0) >= 20 && risk.order.status !== 'cancelled_due_to_20day_breach') {
      await orderSvc.autoCancelForFulfillmentBreach({
        orderId: risk.orderId,
        sellerId,
        asOf,
      })
      autoCancelled += 1
    }
  }

  console.log(
    `[fulfillment-risk] Breached: ${result.breached}, Warning: ${result.warning}, Resolved: ${result.resolved}, Accrued: ${accrued}, Auto-cancelled: ${autoCancelled}`,
  )

  return {
    ...result,
    accrued,
    autoCancelled,
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
