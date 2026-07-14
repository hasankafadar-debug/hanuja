/**
 * One-off repair script — finds orders stuck at `delivery_confirmed` with no
 * Payout record (the activateHold chain was interrupted, e.g. a crash between
 * setDeliveryConfirmed and activateHold) and self-heals them.
 *
 * Root cause + invariant: .claude/rules/12-production-readiness.md §9,
 * docs/07-operations/payout-lifecycle.md. Payout countdown must start from the
 * REAL delivery_confirmed moment, never from "now" — so this script recovers
 * the historical confirmation timestamp from AdminAuditLog
 * (`delivery_confirmed_manual`) before falling back to `order.updatedAt`.
 *
 * Idempotent: safe to re-run. activateHold() no-ops if a Payout already
 * exists for the order; OrderLine stamping only touches unstamped lines.
 *
 * Usage: `pnpm payout:repair`
 *
 * This is a manual/on-demand script — it is NOT run automatically. The
 * equivalent ongoing safety net (for future occurrences of this bug class)
 * lives in api/jobs/payout-maturity.job.ts (sweepMissingPayouts).
 */
import prisma from '../../api/lib/prisma'
import { createPayoutService } from '../../api/services/payout.service'

const REPAIR_ACTOR_ID = 'repair_script'

async function main() {
  const payoutService = createPayoutService({ prisma })

  const orphaned = await prisma.order.findMany({
    where: {
      status: 'delivery_confirmed',
      payouts: { none: {} },
    },
    select: { id: true, publicNumber: true, updatedAt: true, deliveryConfirmedAt: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`[repair-missing-payouts] Found ${orphaned.length} order(s) missing a Payout record.`)

  let repaired = 0
  let failed = 0

  for (const order of orphaned) {
    try {
      // Recover the real confirmation moment from the admin audit trail —
      // payout hold must start from the historical confirmedAt, not "now".
      const confirmationLog = await prisma.adminAuditLog.findFirst({
        where: {
          actionType: 'delivery_confirmed_manual',
          targetType: 'order',
          targetId: order.id,
        },
        orderBy: { createdAt: 'desc' },
        select: { actorId: true, newData: true },
      })

      const confirmedAtFromAudit =
        confirmationLog?.newData &&
        typeof confirmationLog.newData === 'object' &&
        'confirmedAt' in confirmationLog.newData
          ? new Date((confirmationLog.newData as { confirmedAt: string }).confirmedAt)
          : null

      const deliveryConfirmedAt =
        confirmedAtFromAudit ?? order.deliveryConfirmedAt ?? order.updatedAt

      const stampActorId = confirmationLog?.actorId ?? REPAIR_ACTOR_ID

      // Stamp any OrderLines that never received their per-line delivery
      // confirmation timestamp (the original chain broke before this step).
      const stampResult = await prisma.orderLine.updateMany({
        where: { orderId: order.id, deliveryConfirmedAt: null },
        data: { deliveryConfirmedAt, deliveryConfirmedBy: stampActorId },
      })

      // Append-only history note documenting the repair (never overwrite).
      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'delivery_confirmed',
          toStatus: 'delivery_confirmed',
          actorId: REPAIR_ACTOR_ID,
          reason: 'Onarım: hakediş zinciri (activateHold) hiç çalışmamıştı',
          note: `repair-missing-payouts script — ${stampResult.count} satır damgalandı, deliveryConfirmedAt=${deliveryConfirmedAt.toISOString()}`,
        },
      })

      const createdPayouts = await payoutService.activateHold({
        orderId: order.id,
        deliveryConfirmedAt,
      })

      const payoutSummary = Array.isArray(createdPayouts)
        ? createdPayouts.map((p) => `${p.id} (net=${p.netAmount.toString()})`).join(', ')
        : `${createdPayouts.id} (net=${createdPayouts.netAmount.toString()})`

      console.log(
        `[repair-missing-payouts] Order #${order.publicNumber} (${order.id}): holdStartedAt=${deliveryConfirmedAt.toISOString()} → payout(s): ${payoutSummary}`,
      )
      repaired++
    } catch (error) {
      console.error(`[repair-missing-payouts] FAILED for order #${order.publicNumber} (${order.id}):`, error)
      failed++
    }
  }

  console.log(`[repair-missing-payouts] Done. Repaired: ${repaired}, Failed: ${failed}, Total: ${orphaned.length}`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error('[repair-missing-payouts] failed', error)
    await prisma.$disconnect()
    process.exit(1)
  })
