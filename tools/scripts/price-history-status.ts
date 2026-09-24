/**
 * Read-only status of the lowest-price-of-15-days history (e-mail plan phase 6).
 * Prints counts and dates only — no user, e-mail or product data. Safe in production.
 *
 *   pnpm price-history:status
 */
import 'dotenv/config'
import { prisma } from '../../api/lib/prisma'
import { PRICE_DROP_WINDOW_MS } from '../../api/domain/price-drop-eligibility'

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : '-'
}

async function main() {
  const now = new Date()
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [firstRow] = await prisma.productPriceHistory.findMany({
    where: { source: 'baseline' },
    orderBy: { recordedAt: 'asc' },
    take: 1,
    select: { recordedAt: true },
  })
  const tracking = await prisma.priceKeyTracking.aggregate({
    _count: true,
    _min: { trackedSince: true },
    _max: { trackedSince: true },
  })
  const eligibleKeys = await prisma.priceKeyTracking.count({
    where: { trackedSince: { lte: new Date(now.getTime() - PRICE_DROP_WINDOW_MS) } },
  })
  const firstEligible = tracking._min.trackedSince
    ? new Date(tracking._min.trackedSince.getTime() + PRICE_DROP_WINDOW_MS)
    : null

  console.log('history_started_at', iso(firstRow?.recordedAt))
  console.log('tracked_keys', tracking._count)
  console.log('earliest_tracked_since', iso(tracking._min.trackedSince))
  console.log('latest_tracked_since', iso(tracking._max.trackedSince))
  console.log('first_possible_notification_at', iso(firstEligible))
  console.log('keys_with_15_days_of_trusted_history', eligibleKeys)

  console.log(
    'history_rows',
    await prisma.productPriceHistory.groupBy({ by: ['source', 'predicted'], _count: true }),
  )
  console.log(
    'pending_predictions',
    await prisma.productPriceHistory.count({
      where: { predicted: true, materializedAt: null, cancelledAt: null },
    }),
  )
  console.log(
    'unprocessed_markers',
    await prisma.priceChangeMarker.count({ where: { processedAt: null } }),
  )
  console.log(
    'markers_last_7_days',
    await prisma.priceChangeMarker.groupBy({
      by: ['outcome'],
      where: { changedAt: { gte: since } },
      _count: true,
    }),
  )
  console.log(
    'trust_resets_last_7_days',
    await prisma.priceKeyTracking.groupBy({
      by: ['lastResetReason'],
      where: { lastResetAt: { gte: since } },
      _count: true,
    }),
  )
  console.log(
    'events_last_7_days',
    await prisma.priceDropEvent.groupBy({
      by: ['status', 'reason'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
  )
  console.log(
    'recipients_last_7_days',
    await prisma.priceDropRecipient.groupBy({
      by: ['status', 'skipReason'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
  )
  console.log(
    'campaign_reservations_last_7_days',
    await prisma.campaignEmailDispatch.groupBy({
      by: ['source', 'status', 'releaseReason'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
  )
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'PRICE_HISTORY_STATUS_FAILED')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
