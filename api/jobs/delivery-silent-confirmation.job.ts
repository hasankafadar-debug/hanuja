/**
 * Delivery Silent Confirmation Job — runs every few hours.
 * Finds 'delivered' orders where 72h has passed and no open return/dispute,
 * auto-transitions them to 'delivery_confirmed'.
 *
 * After delivery_confirmed, payout hold activation is triggered.
 * Idempotent: delivery.service.silentConfirm() checks eligibility before acting.
 *
 * See: penalty-calculator.ts SILENT_DELIVERY_CONFIRMATION_HOURS = 72
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createOrderRepository } from '../repositories/order.repository'
import { createDeliveryService } from '../services/delivery.service'
import { createPayoutService } from '../services/payout.service'
import { SILENT_DELIVERY_CONFIRMATION_HOURS } from '../domain/penalty-calculator'

export interface DeliverySilentConfirmJobData {
  dryRun?: boolean
}

async function processDeliverySilentConfirmation(
  job: Job<DeliverySilentConfirmJobData>,
) {
  const orderRepo = createOrderRepository(prisma)
  const deliverySvc = createDeliveryService({ prisma })
  const payoutSvc = createPayoutService({ prisma })

  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - SILENT_DELIVERY_CONFIRMATION_HOURS)

  const candidates = await orderRepo.findEligibleForSilentConfirmation(cutoff)

  let confirmed = 0
  let skipped = 0

  for (const order of candidates) {
    if (job.data.dryRun) {
      console.log(`[delivery-silent-confirm] DRY RUN: would confirm order ${order.id}`)
      continue
    }

    const result = await deliverySvc.silentConfirm(order.id)

    if (result) {
      // Activate payout hold
      await payoutSvc.activateHold({
        orderId: order.id,
        deliveryConfirmedAt: result.confirmedAt,
      })
      confirmed++
    } else {
      skipped++
    }
  }

  console.log(
    `[delivery-silent-confirm] Confirmed: ${confirmed}, Skipped: ${skipped}`,
  )
  return { confirmed, skipped }
}

export function startDeliverySilentConfirmWorker() {
  const worker = new Worker<DeliverySilentConfirmJobData>(
    QUEUE_NAMES.DELIVERY_SILENT_CONFIRM,
    processDeliverySilentConfirmation,
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[delivery-silent-confirm] Job ${job?.id} failed:`, err)
  })

  return worker
}
