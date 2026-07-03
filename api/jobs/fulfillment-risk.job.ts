/**
 * Fulfillment Risk Job - runs daily.
 *
 * 1. Refreshes admin-visible line-based risk records.
 * 2. Warning sweep: sellers with an approaching per-product fulfillment deadline
 *    (Product.fulfillmentDays → OrderLine.fulfillmentDueAt) get a one-time
 *    fulfillment_warning_5days notification (deduped per order).
 * 3. Breach sweep: overdue orders accrue the daily 1% late-shipment penalty
 *    (idempotent via lastAccrualAt) and are auto-cancelled with refund
 *    initiation once the accrual reaches overdue day 20.
 *
 * See: .claude/rules/07-marketplace-finance-rules.md, docs/01-business/penalty-policy.md
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createFulfillmentRiskService } from '../services/fulfillment-risk.service'
import { createPenaltyService } from '../services/penalty.service'
import { createOrderService } from '../services/order.service'
import { createNotificationService } from '../services/notification.service'

export interface FulfillmentRiskJobData {
  warnAtDays?: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const AUTO_CANCEL_OVERDUE_DAYS = 20

export async function processFulfillmentRisk(job: Job<FulfillmentRiskJobData>) {
  const asOf = new Date()
  const riskSvc = createFulfillmentRiskService({ prisma })
  const penaltySvc = createPenaltyService({ prisma })
  const orderSvc = createOrderService({ prisma })
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

  // ── Gecikme taraması: günlük %1 birikim + 20. gecikme gününde auto-cancel ──
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

    if (
      (penalty.accrualDayCount ?? 0) >= AUTO_CANCEL_OVERDUE_DAYS &&
      risk.order.status !== 'cancelled_due_to_20day_breach'
    ) {
      await orderSvc.autoCancelForFulfillmentBreach({
        orderId: risk.orderId,
        sellerId,
        asOf,
      })
      autoCancelled += 1
    }
  }

  console.log(
    `[fulfillment-risk] Breached: ${result.breached}, Warning: ${result.warning}, Resolved: ${result.resolved}, Warned: ${warned}, Accrued: ${accrued}, Auto-cancelled: ${autoCancelled}`,
  )

  return {
    ...result,
    warned,
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
