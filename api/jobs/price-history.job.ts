/**
 * Price history worker (e-mail plan phase 6).
 *
 *   tick (every 15 s), in this order:
 *     1. process change markers — unexplained changes reset trust before anything is decided,
 *     2. baseline products that have no tracked key yet (first run after deploy, and products
 *        created by paths without the hook), including the future rule boundaries,
 *     3. materialize predicted rule boundaries whose time has come,
 *     4. decide candidates (products with pending markers wait),
 *     5. release reservations that were never sent in time,
 *     6. advance one lowest-price event (freeze audience / reserve within capacity).
 *   reconcile (hourly): the latest recorded price of every key must equal the computed one.
 *
 * Each step is its own bounded transaction; a failed step is logged and retried next tick.
 */
import { Worker, type Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'

async function step<T>(name: string, run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run()
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    console.warn(`[price-history] ${name} rolled back; retried on the next tick`, {
      code: typeof code === 'string' ? code : error instanceof Error ? error.message.slice(0, 120) : 'UNKNOWN',
    })
    return { error: name }
  }
}

export async function processPriceHistoryJob(job: Job) {
  const { prisma } = await import('../lib/prisma')
  const reconcile = await import('../services/price-change-reconcile.service')
  if (job.name === 'reconcile') {
    await step('markers', () => reconcile.processPriceChangeMarkers(prisma))
    return step('reconcile', () => reconcile.reconcilePriceHistory(prisma))
  }
  const evaluation = await import('../services/price-drop-evaluation.service')
  const { expireStaleCampaignReservations } = await import('../services/campaign-email-reservation')
  const { advancePriceDropDispatch } = await import('../services/price-drop-dispatch.service')

  const markers = await step('markers', () => reconcile.processPriceChangeMarkers(prisma))
  const baseline = await step('baseline', () => reconcile.baselineUntrackedProducts(prisma))
  const materialized = await step('materialize', () => evaluation.materializeDuePredictions(prisma))
  const evaluated = await step('evaluate', () => evaluation.evaluatePriceDropCandidates(prisma))
  const expired = await step('reservations', () => expireStaleCampaignReservations(prisma))
  const dispatch = await step('dispatch', () => advancePriceDropDispatch(prisma))
  if (typeof baseline === 'number' && baseline > 0) {
    console.log(`[price-history] baseline written for ${baseline} product(s)`)
  }
  return { markers, baseline, materialized, evaluated, expired, dispatch }
}

export function startPriceHistoryWorker() {
  const worker = new Worker(QUEUE_NAMES.PRICE_HISTORY, processPriceHistoryJob, {
    connection: redis,
    concurrency: 1,
  })
  worker.on('failed', (job, error) =>
    console.error(`[price-history] ${job?.name ?? 'job'} failed:`, error instanceof Error ? error.message : error),
  )
  return worker
}
