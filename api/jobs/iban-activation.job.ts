import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createSellerBankService } from '../services/seller-bank.service'

async function processIbanActivation(_job: Job) {
  const service = createSellerBankService({ prisma })
  const activated = await service.activateEligiblePending()
  console.log(`[iban-activation] Activated ${activated} pending bank detail(s)`)
  return { activated }
}

export function startIbanActivationWorker() {
  const worker = new Worker(
    QUEUE_NAMES.IBAN_ACTIVATION,
    processIbanActivation,
    { connection: redis, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[iban-activation] Job ${job?.id} failed:`, err)
  })

  return worker
}
