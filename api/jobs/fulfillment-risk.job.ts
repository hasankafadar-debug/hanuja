/**
 * Fulfillment Risk Job - runs daily.
 *
 * 1. Refreshes admin-visible line-based risk records.
 * 2. Warning sweep: sellers with an approaching per-product fulfillment deadline
 *    (Product.fulfillmentDays → OrderLine.fulfillmentDueAt) get a one-time
 *    fulfillment_warning_5days notification (deduped per order).
 * Overdue orders remain visible for admin action; no automatic monetary penalty or cancellation.
 *
 * See: .claude/rules/07-marketplace-finance-rules.md, docs/01-business/penalty-policy.md
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createFulfillmentRiskService } from '../services/fulfillment-risk.service'
import { createNotificationService } from '../services/notification.service'
import { sweepFulfillmentRiskNotifications } from '../services/fulfillment-risk-notification.service'

export interface FulfillmentRiskJobData {
  warnAtDays?: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export async function processFulfillmentRisk(job: Job<FulfillmentRiskJobData>) {
  const asOf = new Date()
  const riskSvc = createFulfillmentRiskService({ prisma })
  const notificationSvc = createNotificationService({ prisma })

  const result = await riskSvc.refreshActiveRisks(asOf)

  // ── Uyarı taraması: deadline yaklaşan siparişler (sipariş başına tek bildirim) ──
  let warned = 0
  const warningRisks = await prisma.fulfillmentRisk.findMany({
    where: { status: 'warning' },
    include: {
      seller: { select: { user: { select: { id: true } } } },
      order: { select: { id: true, publicNumber: true } },
    },
  })

  for (const risk of warningRisks) {
    const sellerUserId = risk.seller?.user?.id
    if (!sellerUserId) continue

    const alreadyWarned = await prisma.notification.findFirst({
      where: {
        type: 'fulfillment_warning_5days',
        data: { path: ['orderId'], equals: risk.orderId },
      },
      select: { id: true },
    })
    if (alreadyWarned) continue

    const daysRemaining = Math.max(
      0,
      Math.ceil((risk.deadlineAt.getTime() - asOf.getTime()) / MS_PER_DAY),
    )
    await notificationSvc.notifySellerFulfillmentWarning(
      sellerUserId,
      risk.orderId,
      String(risk.order.publicNumber),
      daysRemaining,
    )
    warned += 1
  }

  // Operations mailbox: first risk and every level change, per order + seller.
  const opsNotifications = await sweepFulfillmentRiskNotifications(prisma, asOf)

  console.log(
    `[fulfillment-risk] Breached: ${result.breached}, Warning: ${result.warning}, Resolved: ${result.resolved}, Warned: ${warned}, Ops notified: ${opsNotifications.notified}`,
  )

  return {
    ...result,
    warned,
    opsNotifications,
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
