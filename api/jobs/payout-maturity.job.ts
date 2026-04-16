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

async function processPayoutMaturity(_job: Job<PayoutMaturityJobData>) {
  const payoutRepo = createPayoutRepository(prisma)
  const payoutSvc = createPayoutService({ prisma })

  const readyCandidates = await payoutRepo.findReadyForRelease()

  let released = 0
  let skipped = 0

  for (const payout of readyCandidates) {
    const readiness = await payoutSvc.checkReadiness(payout.id)

    if (readiness.ready) {
      await payoutSvc.release({
        payoutId: payout.id,
        adminActorId: 'system:payout-maturity-job',
        reason: 'Hold süresi doldu, otomatik serbest bırakma',
      })
      released++
    } else {
      // Mark as blocked so it doesn't keep appearing in the ready query
      if (readiness.reason && payout.status === 'hold_active') {
        await payoutRepo.block(payout.id, readiness.reason)
      }
      skipped++
    }
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
