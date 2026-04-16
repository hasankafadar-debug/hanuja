/**
 * Repeatable job scheduler — called once at worker startup.
 *
 * Registers BullMQ repeatable (cron) jobs for the three periodic workflows
 * that MUST run on a schedule, not only on events:
 *
 *   1. payout-maturity        — daily at 02:00 UTC
 *      Checks hold_active payouts where holdUntil has passed and
 *      no blocking condition exists; transitions them to payout_ready.
 *
 *   2. delivery-silent-confirm — every 30 minutes
 *      Checks 'delivered' orders older than 72h with no open return/dispute;
 *      auto-transitions to delivery_confirmed → activates payout hold.
 *
 *   3. fulfillment-risk        — daily at 08:00 UTC
 *      Scans active orders approaching or past the 20-day fulfillment deadline;
 *      flags them for admin review (does NOT auto-cancel).
 *
 * BullMQ deduplicates repeatable jobs by (queue + jobName + repeat key).
 * Calling this function on every worker restart is safe — existing schedules
 * are preserved or updated in place.
 *
 * See: 07-marketplace-finance-rules.md, 08-order-lifecycle-rules.md
 */
import {
  payoutMaturityQueue,
  deliverySilentConfirmQueue,
  fulfillmentRiskQueue,
} from '../lib/queue'

export async function scheduleRepeatableJobs(): Promise<void> {
  // ── 1. Payout maturity — daily at 02:00 UTC ─────────────────────────────────
  await payoutMaturityQueue.add(
    'payout-maturity-daily',
    {},
    {
      repeat: {
        pattern: '0 2 * * *', // 02:00 UTC every day
        tz: 'UTC',
      },
      // removeOnComplete: only keep the last 10 runs
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    },
  )

  // ── 2. Delivery silent confirmation — every 30 minutes ──────────────────────
  await deliverySilentConfirmQueue.add(
    'delivery-silent-confirm-periodic',
    {},
    {
      repeat: {
        pattern: '*/30 * * * *', // Every 30 minutes
        tz: 'UTC',
      },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    },
  )

  // ── 3. Fulfillment risk scan — daily at 08:00 UTC ────────────────────────────
  await fulfillmentRiskQueue.add(
    'fulfillment-risk-daily',
    { warnAtDays: 17 }, // Warn 3 days before the 20-day limit
    {
      repeat: {
        pattern: '0 8 * * *', // 08:00 UTC every day
        tz: 'UTC',
      },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    },
  )

  console.log('[scheduler] Repeatable jobs registered:')
  console.log('  - payout-maturity-daily         → 02:00 UTC daily')
  console.log('  - delivery-silent-confirm        → every 30 min')
  console.log('  - fulfillment-risk-daily         → 08:00 UTC daily')
}
