/**
 * Campaign Discount Job — fans out discount notifications and activates
 * scheduled discount rules.
 *
 * Two job names on one worker:
 *
 *   1. fan-out         — notifies both audiences for a single discount campaign:
 *      a) store followers      (store-follow.service)
 *      b) favorite/cart holders (campaign-discount.service)
 *      Each audience is dispatched independently: a failure in one does not skip
 *      the other. The job only fails if BOTH audiences fail, so BullMQ retries
 *      re-run the whole fan-out (dispatch dedupe by fingerprint keeps it safe).
 *
 *   2. activation-scan — periodic sweep (every 15 min):
 *      • SCHEDULED rules whose startsAt has passed → ACTIVE, then enqueue one
 *        fan-out per newly-activated rule.
 *      • ACTIVE rules whose endsAt has passed → EXPIRED (no notification).
 *      Idempotent: status transitions are guarded by a conditional updateMany,
 *      and fan-out dedupe is by discountFingerprint.
 *
 * See: .claude/rules/08-order-lifecycle-rules.md, docs/06-engineering/queue-jobs-plan.md
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES, campaignDiscountQueue } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createStoreFollowService } from '../services/store-follow.service'
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
  const storeFollowService = createStoreFollowService({ prisma })
  const campaignService = createCampaignDiscountService({ prisma })

  let followersFailed = false
  let audienceFailed = false

  try {
    await storeFollowService.notifyFollowersAboutDiscount({
      sellerId: data.sellerId,
      sellerName: data.sellerName,
      sellerSlug: data.sellerSlug,
      discountRuleId: data.discountRuleId,
      discountFingerprint: data.discountFingerprint,
    })
  } catch (err) {
    followersFailed = true
    console.error('[campaign-discount] Store-follower fan-out failed:', err)
  }

  try {
    await campaignService.notifyDiscountAudience({
      discountRuleId: data.discountRuleId,
      discountFingerprint: data.discountFingerprint,
      sellerName: data.sellerName,
    })
  } catch (err) {
    audienceFailed = true
    console.error('[campaign-discount] Favorite/cart fan-out failed:', err)
  }

  // Only fail the job when BOTH audiences failed, so a retry re-runs the whole
  // fan-out. Fingerprint dedupe makes re-dispatch to the succeeded audience safe.
  if (followersFailed && audienceFailed) {
    throw new Error(
      `[campaign-discount] fan-out failed for rule ${data.discountRuleId}: both audiences errored`,
    )
  }
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
