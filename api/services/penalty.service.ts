/**
 * Penalty Service - applies, accrues, offsets, and waives seller penalties.
 *
 * Rejection penalty: fixed 20% of product amount.
 * Late-shipment penalty: 1% per overdue day, auto-cancel on day 20.
 */
import type { OrderStatus, PrismaClient, PenaltyReason } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError } from '../lib/errors'
import { createPenaltyRepository } from '../repositories/penalty.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createOrderLineRepository } from '../repositories/order-line.repository'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createNotificationService } from './notification.service'
import {
  calculateDailyLateShipmentPenalty,
  calculatePenalty,
  getLateShipmentBreachDayCount,
  getLateShipmentPenaltyRate,
} from '../domain/penalty-calculator'
import { addBusinessDays } from '../domain/business-days'
import { createPlatformSettingsService } from './platform-settings.service'

interface PenaltyServiceDeps {
  prisma: PrismaClient
}

const ACTIVE_LATE_SHIPMENT_STATUSES: OrderStatus[] = [
  'seller_queue_ready',
  'seller_reviewing',
  'seller_accepted',
  'preparing',
  'awaiting_shipment',
]

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function getFulfillmentDeadline(order: {
  paymentConfirmedAt?: Date | null
  sellerQueueReadyAt?: Date | null
  createdAt: Date
}, fulfillmentDays: number) {
  const source = order.paymentConfirmedAt ?? order.sellerQueueReadyAt ?? order.createdAt
  return addBusinessDays(source, fulfillmentDays)
}

export function createPenaltyService({ prisma }: PenaltyServiceDeps) {
  const penalties = createPenaltyRepository(prisma)
  const orders = createOrderRepository(prisma)
  const orderLines = createOrderLineRepository(prisma)
  const ledger = createSellerLedgerRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)
  const notifications = createNotificationService({ prisma })
  const platformSettings = createPlatformSettingsService({ prisma })

  return {
    /**
     * Rejection penalty remains the fixed 20% policy.
     */
    async applyForCancellation(params: {
      orderId: string
      sellerId: string
      reason: PenaltyReason
    }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      const existing = await penalties.findByOrderIdAndReason(params.orderId, params.reason)
      if (existing) return existing

      const lines = await orderLines.findByOrderIdForSeller(params.orderId, params.sellerId)
      if (!lines.length) throw new NotFoundError('OrderLine', params.orderId)

      const productAmount = lines.reduce((sum, line) => sum.plus(line.totalPrice), new Decimal(0))

      const settings = await platformSettings.get()
      const penaltyRate = settings.standardPenaltyRate
      const penaltyAmount = calculatePenalty(productAmount, penaltyRate)

      return prisma.$transaction(async (tx) => {
        const penalty = await penalties.create(
          {
            sellerId: params.sellerId,
            orderId: params.orderId,
            reason: params.reason,
            baseAmount: productAmount,
            rate: penaltyRate,
            penaltyAmount,
          },
          tx as PrismaClient,
        )

        await ledger.createEntry({
          sellerId: params.sellerId,
          type: 'penalty',
          amount: penaltyAmount.negated(),
          orderId: params.orderId,
          penaltyId: penalty.id,
          description: `Ceza: ${params.reason} — ${penaltyAmount.toFixed(2)} TRY (fatura kesilince satıcı ekstresinde görünür)`,
          visibleToSeller: false,
        })

        return penalty
      })
    },

    /**
     * Daily late shipment accrual. Idempotent for the same calendar day.
     * If the worker misses days, it catches up in one run.
     *
     * If an approved fulfillment extension is in effect, the deadline is
     * shifted by the granted number of business days and accrual pauses.
     */
    async accrueDailyLateShipment(params: {
      orderId: string
      asOf?: Date
    }) {
      const asOf = startOfDay(params.asOf ?? new Date())
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          lines: { select: { sellerId: true, totalPrice: true } },
        },
      })
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (!ACTIVE_LATE_SHIPMENT_STATUSES.includes(order.status)) return null

      const sellerId = order.lines[0]?.sellerId
      if (!sellerId) throw new NotFoundError('OrderLine', params.orderId)

      const settings = await platformSettings.get()
      const baseDeadlineAt = getFulfillmentDeadline(order, settings.fulfillmentDays)

      // If an approved extension exists, push the deadline forward by the
      // granted business-day count. This effectively pauses accrual for the
      // duration of the window.
      const activeExtension = await prisma.fulfillmentExtensionRequest.findFirst({
        where: {
          orderId: params.orderId,
          status: 'approved',
          approvedDays: { not: null },
        },
        select: { approvedDays: true },
        orderBy: { approvedAt: 'desc' },
      })
      const effectiveDeadline = activeExtension?.approvedDays
        ? addBusinessDays(baseDeadlineAt, activeExtension.approvedDays)
        : baseDeadlineAt

      const breachDayCount = getLateShipmentBreachDayCount(effectiveDeadline, asOf)
      if (breachDayCount <= 0) return null

      const existing = await penalties.findByOrderIdAndReason(params.orderId, 'late_shipment_daily_accrual')
      if (existing?.lastAccrualAt && startOfDay(existing.lastAccrualAt).getTime() === asOf.getTime()) {
        return existing
      }

      const dailyRate = settings.dailyPenaltyRate
      const baseAmount = order.lines.reduce((sum, line) => sum.plus(line.totalPrice), new Decimal(0))
      const accruedRate = getLateShipmentPenaltyRate(breachDayCount, dailyRate)
      const totalPenaltyAmount = calculateDailyLateShipmentPenalty(baseAmount, breachDayCount, dailyRate)
      const currentAccrualDayCount = existing?.accrualDayCount ?? 0
      const incrementalDays = Math.max(0, breachDayCount - currentAccrualDayCount)
      const incrementalAmount = calculateDailyLateShipmentPenalty(baseAmount, incrementalDays, dailyRate)

      return prisma.$transaction(async (tx) => {
        let penalty = existing

        if (!penalty) {
          penalty = await penalties.create(
            {
              sellerId,
              orderId: params.orderId,
              reason: 'late_shipment_daily_accrual',
              baseAmount,
              rate: accruedRate,
              penaltyAmount: totalPenaltyAmount,
              accrualSourceDate: effectiveDeadline,
              accrualDayCount: breachDayCount,
              dailyAccrualRate: dailyRate,
              lastAccrualAt: asOf,
            },
            tx as PrismaClient,
          )
        } else {
          penalty = await penalties.updateAccrual(
            penalty.id,
            {
              rate: accruedRate,
              penaltyAmount: totalPenaltyAmount,
              accrualDayCount: breachDayCount,
              lastAccrualAt: asOf,
            },
            tx as PrismaClient,
          )
        }

        if (incrementalAmount.gt(0)) {
          await ledger.createEntry({
            sellerId,
            type: 'penalty',
            amount: incrementalAmount.negated(),
            orderId: params.orderId,
            penaltyId: penalty.id,
            description:
              incrementalDays === 1
                ? `Geç sevkiyat günlük ceza birikimi: 1 gün (%${dailyRate.mul(100).toFixed(0)}) — fatura kesilince satıcı ekstresinde görünür`
                : `Geç sevkiyat günlük ceza birikimi: +${incrementalDays} gün (%${dailyRate.mul(100).toFixed(0)}/gün) — fatura kesilince satıcı ekstresinde görünür`,
            visibleToSeller: false,
          })
        }

        return penalty
      })
    },

    /**
     * Waive a penalty - admin only, reason required.
     * Original penalty record is preserved with status='waived'.
     */
    async waive(params: {
      penaltyId: string
      adminActorId: string
      waiverReason: string
    }) {
      const penalty = await penalties.findById(params.penaltyId)
      if (!penalty) throw new NotFoundError('Penalty', params.penaltyId)

      if (penalty.status === 'waived') return penalty

      // Original penalty entry visibility drives waiver visibility — if the
      // seller already saw the penalty (invoice issued), they must see the
      // waiver too; otherwise both stay hidden.
      const originalPenaltyEntry = await ledger.findByReference({
        sellerId: penalty.sellerId,
        type: 'penalty',
        referenceType: 'penalty',
        referenceId: penalty.id,
      })
      const waiverVisible = originalPenaltyEntry?.visibleToSeller ?? false

      return prisma.$transaction(async () => {
        const waived = await penalties.waive(params.penaltyId, {
          waivedBy: params.adminActorId,
          waiverReason: params.waiverReason,
        })

        await ledger.createEntry({
          sellerId: penalty.sellerId,
          type: 'manual_adjustment',
          amount: penalty.penaltyAmount,
          orderId: penalty.orderId,
          penaltyId: penalty.id,
          description: `Ceza muafiyeti: ${params.waiverReason}`,
          createdBy: params.adminActorId,
          visibleToSeller: waiverVisible,
        })

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'penalty_waived',
          targetType: 'penalty',
          targetId: params.penaltyId,
          previousData: { status: penalty.status, penaltyAmount: penalty.penaltyAmount },
          newData: { status: 'waived' },
          reason: params.waiverReason,
        })

        return waived
      })
    },

    async applyManually(params: {
      orderId: string
      sellerId: string
      adminActorId: string
      manualReason: string
      penaltyAmount?: Decimal
    }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      const seller = await prisma.seller.findUnique({
        where: { id: params.sellerId },
        include: { user: { select: { id: true } } },
      })
      if (!seller) throw new NotFoundError('Seller', params.sellerId)

      const existing = await penalties.findByOrderIdAndReason(params.orderId, 'other')
      if (existing) return existing

      const lines = await orderLines.findByOrderIdForSeller(params.orderId, params.sellerId)
      if (!lines.length) throw new NotFoundError('OrderLine', params.orderId)

      const baseAmount = lines.reduce((sum, line) => sum.plus(line.totalPrice), new Decimal(0))
      const settings = await platformSettings.get()
      const penaltyAmount = params.penaltyAmount ?? calculatePenalty(baseAmount, settings.standardPenaltyRate)
      const rate = baseAmount.toNumber() > 0 ? penaltyAmount.div(baseAmount) : settings.standardPenaltyRate

      const penalty = await prisma.$transaction(async (tx) => {
        const created = await penalties.create(
          {
            sellerId: params.sellerId,
            orderId: params.orderId,
            reason: 'other',
            baseAmount,
            rate,
            penaltyAmount,
          },
          tx as PrismaClient,
        )

        await ledger.createEntry({
          sellerId: params.sellerId,
          type: 'penalty',
          amount: penaltyAmount.negated(),
          orderId: params.orderId,
          penaltyId: created.id,
          description: `Manuel ceza: ${params.manualReason} (fatura kesilince satıcı ekstresinde görünür)`,
          createdBy: params.adminActorId,
          visibleToSeller: false,
        })

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'penalty_applied',
          targetType: 'penalty',
          targetId: created.id,
          newData: {
            orderId: params.orderId,
            sellerId: params.sellerId,
            penaltyAmount,
            baseAmount,
            rate,
          },
          reason: params.manualReason,
        })

        return created
      })

      await notifications.send({
        userId: seller.user.id,
        type: 'seller_penalty_applied',
        title: 'Ceza uygulandı',
        body: `${penaltyAmount.toFixed(2)} tutarında ceza hesabınıza yansıtıldı.`,
        data: { orderId: params.orderId, penaltyId: penalty.id },
      })

      return penalty
    },

    /**
     * Roll back all daily-late-shipment accrual ledger entries for an order
     * when a fulfillment extension request is approved. Without this, the
     * Penalty.penaltyAmount (recomputed from the new effective deadline)
     * would drift from the ledger total — the ledger would keep the old
     * debits even though the penalty record shows none.
     *
     * Behaviour:
     *   - Find the late-shipment accrual penalty for the order.
     *   - Sum its existing ledger entries (all are negative debits).
     *   - Write a single positive credit entry referencing the extension.
     *   - Reset Penalty.penaltyAmount/accrualDayCount/rate to zero and clear
     *     lastAccrualAt so subsequent accrual can resume cleanly if the
     *     extended deadline is also breached.
     *
     * Returns null when there is no accrual to reverse.
     */
    async reverseAccrualForExtension(params: {
      orderId: string
      extensionRequestId: string
      adminActorId: string
    }) {
      const penalty = await penalties.findByOrderIdAndReason(
        params.orderId,
        'late_shipment_daily_accrual',
      )
      if (!penalty) return null

      return prisma.$transaction(async (tx) => {
        const totalAgg = await tx.sellerLedgerEntry.aggregate({
          where: {
            sellerId: penalty.sellerId,
            type: 'penalty',
            referenceType: 'penalty',
            referenceId: penalty.id,
          },
          _sum: { amount: true },
        })
        const amountSum = totalAgg._sum.amount ?? new Decimal(0)
        // amountSum is negative (debit) for any accrued days.
        if (amountSum.gte(0)) {
          // Nothing to reverse, but still clear the accrual snapshot for cleanliness.
          await penalties.updateAccrual(
            penalty.id,
            {
              penaltyAmount: new Decimal(0),
              accrualDayCount: 0,
              rate: new Decimal(0),
              lastAccrualAt: null,
            },
            tx as unknown as PrismaClient,
          )
          return penalty
        }

        const reversalAmount = amountSum.negated()
        const shortId = params.extensionRequestId.slice(-8).toUpperCase()
        await ledger.createEntry(
          {
            sellerId: penalty.sellerId,
            type: 'manual_adjustment',
            amount: reversalAmount,
            orderId: params.orderId,
            penaltyId: penalty.id,
            referenceType: 'extension_request',
            referenceId: params.extensionRequestId,
            description: `Ek süre onaylandı (#${shortId}) — günlük gecikme cezası geri alındı (${reversalAmount.toFixed(2)} TRY)`,
            createdBy: params.adminActorId,
            // Match the visibility of the accrual entries we're reversing.
            // Accrual entries are written invisible (revealed only when an
            // invoice is issued); the reversal stays invisible to mirror that.
            visibleToSeller: false,
          },
          tx as unknown as PrismaClient,
        )

        await penalties.updateAccrual(
          penalty.id,
          {
            penaltyAmount: new Decimal(0),
            accrualDayCount: 0,
            rate: new Decimal(0),
            lastAccrualAt: null,
          },
          tx as unknown as PrismaClient,
        )

        return penalty
      })
    },

    listForSeller(sellerId: string, skip?: number, take?: number) {
      return penalties.listBySeller({
        sellerId,
        ...(skip !== undefined ? { skip } : {}),
        ...(take !== undefined ? { take } : {}),
      })
    },

    listForAdmin(params: Parameters<typeof penalties.listForAdmin>[0]) {
      return penalties.listForAdmin(params)
    },
  }
}

export type PenaltyService = ReturnType<typeof createPenaltyService>
