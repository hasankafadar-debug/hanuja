/**
 * Campaign Discount Job — cart discount notifications and scheduled rule activation.
 *
 * Two job names on one worker:
 *
 *   1. fan-out         — notifies users who have a discounted product in their cart
 *      (campaign-discount.service). Store followers and favoriters are no longer notified
 *      here (phase 6, 2026-09-24): favoriters get the lowest-price-of-15-days e-mail from the
 *      price-history queue, and following a store alone is no notification reason. A failure
 *      fails the job so BullMQ retries it; reservations make the retry safe.
 *
 *   2. activation-scan — periodic sweep (every 15 min):
 *      • SCHEDULED rules whose startsAt has passed → ACTIVE, then enqueue one
 *        fan-out per newly-activated rule.
 *      • ACTIVE rules whose endsAt has passed → EXPIRED (no notification).
 *      Idempotent: status transitions are guarded by a conditional updateMany.
 *      These status flips do not change any price (the live status already follows the
 *      clock), so the price-change triggers leave no marker for them.
 *
 * See: .claude/rules/08-order-lifecycle-rules.md, docs/06-engineering/queue-jobs-plan.md
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES, campaignDiscountQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import {
  createCampaignDiscountService,
  buildDiscountFingerprint,
} from '../services/campaign-discount.service'

export interface CampaignFanOutJobData {
  discountRuleId: string
  discountFingerprint: string
  sellerId: string
  sellerName: string
  sellerSlug: string
}

export type CampaignDiscountJobData = CampaignFanOutJobData | Record<string, never>

const FAN_OUT_JOB_NAME = 'fan-out'
const ACTIVATION_SCAN_JOB_NAME = 'activation-scan'

async function processFanOut(data: CampaignFanOutJobData): Promise<void> {
  const campaignService = createCampaignDiscountService({ prisma })
  await campaignService.notifyDiscountAudience({
    discountRuleId: data.discountRuleId,
    discountFingerprint: data.discountFingerprint,
    sellerName: data.sellerName,
  })
}

async function processActivationScan(): Promise<{ activated: number; expired: number }> {
  const now = new Date()

  // ── Activate SCHEDULED rules whose start time has passed ────────────────────
  const dueRules = await prisma.discountRule.findMany({
    where: { status: 'SCHEDULED', startsAt: { lte: now } },
    include: { seller: { select: { id: true, displayName: true, slug: true } } },
  })

  let activated = 0
  for (const rule of dueRules) {
    // Guarded transition — only the run that flips SCHEDULED→ACTIVE enqueues.
    const transition = await prisma.discountRule.updateMany({
      where: { id: rule.id, status: 'SCHEDULED' },
      data: { status: 'ACTIVE' },
    })
    if (transition.count === 0) continue

    await campaignDiscountQueue.add(
      FAN_OUT_JOB_NAME,
      {
        discountRuleId: rule.id,
        discountFingerprint: buildDiscountFingerprint(rule),
        sellerId: rule.seller.id,
        sellerName: rule.seller.displayName,
        sellerSlug: rule.seller.slug,
      } satisfies CampaignFanOutJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    )
    activated += 1
  }

  // ── Expire ACTIVE rules whose end time has passed (no notification) ─────────
  const expiredResult = await prisma.discountRule.updateMany({
    where: { status: 'ACTIVE', endsAt: { lt: now } },
    data: { status: 'EXPIRED' },
  })

  console.log(
    `[campaign-discount] activation-scan: activated ${activated}, expired ${expiredResult.count}`,
  )

  return { activated, expired: expiredResult.count }
}

export async function processCampaignDiscountJob(job: Job<CampaignDiscountJobData>) {
  if (job.name === ACTIVATION_SCAN_JOB_NAME) {
    return processActivationScan()
  }

  if (job.name === FAN_OUT_JOB_NAME) {
    await processFanOut(job.data as CampaignFanOutJobData)
    return undefined
  }

  console.warn(`[campaign-discount] Unknown job name: ${job.name}`)
  return undefined
}

export function startCampaignDiscountWorker() {
  const worker = new Worker<CampaignDiscountJobData>(
    QUEUE_NAMES.CAMPAIGN_DISCOUNT,
    processCampaignDiscountJob,
    { connection: redis, concurrency: 3 },
  )

  worker.on('failed', (job: { id?: string } | undefined, err: Error) => {
    console.error(`[campaign-discount] Job ${job?.id} failed:`, err)
  })

  return worker
}
