/**
 * Payout Maturity Job — runs periodically (e.g. daily).
 * Finds payouts where hold_until has passed and no blocking issues exist,
 * then transitions them from 'hold_active' to 'ready'.
 *
 * Idempotent: safe to re-run, uses checkReadiness() guard.
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createPayoutRepository } from '../repositories/payout.repository'
import { createPayoutService } from '../services/payout.service'

export interface PayoutMaturityJobData {
  batchSize?: number
}

/**
 * Safety-net sweep: finds missing seller payouts and accrual entries on
 * delivery-confirmed orders, including partially completed multi-seller orders.
 *
 * Idempotent (existing snapshots/entries remain unchanged) and resilient —
 * a failure on one order is logged and does not stop the sweep from
 * processing the rest. See .claude/rules/12-production-readiness.md §9,
 * repair-missing-payouts.ts (one-off backfill for pre-existing gaps).
 */
async function sweepMissingPayouts(payoutRepo: ReturnType<typeof createPayoutRepository>, payoutSvc: ReturnType<typeof createPayoutService>) {
  let repaired = 0
  let failed = 0

  const orphaned = await payoutRepo.findDeliveryConfirmedOrdersMissingPayout()
  for (const order of orphaned) {
    const deliveryConfirmedAt = order.deliveryConfirmedAt ?? order.updatedAt
    try {
      await payoutSvc.activateHold({ orderId: order.id, deliveryConfirmedAt })
      console.warn(
        `[payout-maturity] sweep: repaired missing payout for order #${order.publicNumber} (${order.id}), holdStartedAt=${deliveryConfirmedAt.toISOString()}`,
      )
      repaired++
    } catch (error) {
      console.error(
        `[payout-maturity] sweep: failed to repair order #${order.publicNumber} (${order.id})`,
        error,
      )
      failed++
    }
  }

  if (repaired > 0 || failed > 0) {
    console.warn(`[payout-maturity] sweep summary — repaired: ${repaired}, failed: ${failed}`)
  }

  return { repaired, failed }
}

/**
 * Safety net for the invoice-based due date (satıcı Hanuja modeli): an approval normally
 * sets `holdUntil` right away, but a failed post-commit sync would leave the payout
 * without a due date and outside the maturity pass below.
 */
async function sweepMissingDueDates(payoutSvc: ReturnType<typeof createPayoutService>) {
  // Only payouts still waiting for a due date; the approved invoice is checked per pair.
  const payouts = await prisma.payout.findMany({
    where: { holdUntil: null, status: { notIn: ['payout_paid', 'payout_offset'] } },
    select: { orderId: true, sellerId: true },
  })
  for (const payout of payouts) {
    const invoice = await prisma.orderSellerInvoice.findUnique({
      where: { orderId_sellerId: { orderId: payout.orderId, sellerId: payout.sellerId } },
      select: { reviewStatus: true },
    })
    if (invoice?.reviewStatus !== 'approved') continue
    try {
      await payoutSvc.syncInvoiceDueDate(payout)
    } catch (error) {
      console.error(`[payout-maturity] due date sync failed for order ${payout.orderId}`, error)
    }
  }
}

async function processPayoutMaturity(_job: Job<PayoutMaturityJobData>) {
  const payoutRepo = createPayoutRepository(prisma)
  const payoutSvc = createPayoutService({ prisma })

  // Self-healing sweeps run first so any newly-repaired payouts are eligible
  // for the same maturity pass below.
  await sweepMissingPayouts(payoutRepo, payoutSvc)
  await sweepMissingDueDates(payoutSvc)

  const readyCandidates = await payoutRepo.findReadyForRelease()

  let released = 0
  let skipped = 0

  for (const payout of readyCandidates) {
    const readiness = await payoutSvc.reevaluate(payout.id)
    if (readiness.ready) released++
    else skipped++
  }

  console.log(`[payout-maturity] Released: ${released}, Skipped/blocked: ${skipped}`)
  return { released, skipped }
}

export function startPayoutMaturityWorker() {
  const worker = new Worker<PayoutMaturityJobData>(
    QUEUE_NAMES.PAYOUT_MATURITY,
    processPayoutMaturity,
    {
      connection: redis,
      concurrency: 1, // Single concurrency — finance-critical
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[payout-maturity] Job ${job?.id} failed:`, err)
  })

  return worker
}
