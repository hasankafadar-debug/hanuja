/**
 * Penalty Service - applies, accrues, offsets, and waives seller penalties.
 *
 * Rejection penalty: fixed 20% of product amount.
 * Late-shipment penalty: 1% per overdue day, auto-cancel on day 20.
 */
import type { OrderStatus, PrismaClient, PenaltyReason } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { lockSellerFinance } from '../lib/seller-finance-lock'
import { syncSellerPayoutBatches } from '../lib/payout-batch-totals'
import { NotFoundError, ValidationError } from '../lib/errors'
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
  const notifications = createNotificationService({ prisma })
  const platformSettings = createPlatformSettingsService({ prisma })

  async function changePenalty(params: {
    penaltyId: string; adminActorId: string; amount?: Decimal; reason: string; waive?: boolean
  }) {
    if (params.reason.trim().length < 3) throw new ValidationError('Düzeltme gerekçesi gerekli.')
    if (params.amount && (!params.amount.isFinite() || params.amount.lte(0) || params.amount.decimalPlaces() > 2)) {
      throw new ValidationError('Ceza tutarı pozitif ve en fazla iki ondalıklı olmalı.')
    }
    const identity = await prisma.penalty.findUnique({ where: { id: params.penaltyId }, select: { sellerId: true } })
    if (!identity) throw new NotFoundError('Penalty', params.penaltyId)
    return prisma.$transaction(async tx => {
      await lockSellerFinance(tx, [identity.sellerId])
      const current = await tx.penalty.findUnique({ where: { id: params.penaltyId } })
      if (!current) throw new NotFoundError('Penalty', params.penaltyId)
      if (current.status === 'waived') {
        if (params.waive) return current
        throw new ValidationError('Muaf tutulmuş ceza düzenlenemez.')
      }
      const amount = params.waive ? new Decimal(0) : params.amount ?? current.penaltyAmount
      const delta = current.penaltyAmount.minus(amount)
      const sources = await tx.sellerLedgerEntry.findMany({
        where: { sellerId: current.sellerId, type: 'penalty', OR: [
          { referenceType: 'penalty', referenceId: current.id },
          { referenceType: 'order', referenceId: current.orderId },
        ] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      const source = sources.find(e => e.referenceType === 'penalty') ?? sources[0]
      // Preserve the amount of an old explicit settlement before an admin changes
      // penaltyAmount/status. Future debt reads must not reinterpret that payment.
      if (current.offsetPayoutId && source) {
        const linked = await tx.payoutDebtOffset.findFirst({
          where: { payoutId: current.offsetPayoutId, ledgerEntryId: { in: sources.map(e => e.id) } },
        })
        if (!linked) {
          let remaining = current.penaltyAmount
          for (const entry of sources.filter(e => e.referenceType === source.referenceType && e.referenceId === source.referenceId)) {
            const applied = Decimal.min(remaining, Decimal.max(0, entry.amount.negated()))
            if (applied.gt(0)) await tx.payoutDebtOffset.create({ data: {
              payoutId: current.offsetPayoutId, ledgerEntryId: entry.id, amount: applied,
            } })
            remaining = remaining.minus(applied)
          }
        }
      }
      // Legacy penalty writers used order references. Keep corrections in that
      // same source group so the debt allocator can cancel the outstanding debit.
      if (!delta.isZero()) await ledger.createEntry({
        sellerId: current.sellerId, type: 'manual_adjustment', amount: delta,
        referenceType: source?.referenceType ?? 'penalty', referenceId: source?.referenceId ?? current.id,
        description: `${params.waive ? 'Ceza muafiyeti' : 'Ceza tutarı düzeltmesi'}: ${params.reason.trim()}`,
        createdBy: params.adminActorId, visibleToSeller: sources.some(e => e.visibleToSeller),
      }, tx)
      const updated = await tx.penalty.update({ where: { id: current.id }, data: params.waive ? {
        status: 'waived', waivedBy: params.adminActorId, waivedAt: new Date(), waiverReason: params.reason.trim(),
      } : { penaltyAmount: amount,
        rate: current.baseAmount.gt(0) ? amount.div(current.baseAmount).toDecimalPlaces(4) : current.rate,
      } })
      await createAdminAuditLogRepository(tx).createEntry({
        actorId: params.adminActorId, actionType: params.waive ? 'penalty_waived' : 'manual_ledger_adjustment',
        targetType: 'penalty', targetId: current.id,
        previousData: { status: current.status, penaltyAmount: current.penaltyAmount.toFixed(2) },
        newData: { status: updated.status, penaltyAmount: updated.penaltyAmount.toFixed(2), ledgerDelta: delta.toFixed(2) },
        reason: params.reason.trim(),
      })
      await syncSellerPayoutBatches(tx, current.sellerId)
      return updated
    })
  }

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
        await lockSellerFinance(tx, [params.sellerId])
        const duplicate = await tx.penalty.findFirst({ where: { orderId: params.orderId, sellerId: params.sellerId, reason: params.reason } })
        if (duplicate) return duplicate
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
          referenceType: 'penalty', referenceId: penalty.id,
          description: `Ceza: ${params.reason} — ${penaltyAmount.toFixed(2)} TRY (fatura kesilince satıcı ekstresinde görünür)`,
          visibleToSeller: false,
        }, tx)

        await syncSellerPayoutBatches(tx, penalty.sellerId)
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

      return prisma.$transaction(async (tx) => {
        await lockSellerFinance(tx, [sellerId])
        const existing = await tx.penalty.findFirst({ where: { orderId: params.orderId, sellerId, reason: 'late_shipment_daily_accrual' } })
        if (existing?.status === 'waived') return existing
        if (existing?.lastAccrualAt && startOfDay(existing.lastAccrualAt).getTime() === asOf.getTime()) {
          return existing
        }

        const dailyRate = settings.dailyPenaltyRate
        const baseAmount = order.lines.reduce((sum, line) => sum.plus(line.totalPrice), new Decimal(0))
        const accruedRate = getLateShipmentPenaltyRate(breachDayCount, dailyRate)
        const scheduledTotal = calculateDailyLateShipmentPenalty(baseAmount, breachDayCount, dailyRate)
        const currentAccrualDayCount = existing?.accrualDayCount ?? 0
        const incrementalDays = Math.max(0, breachDayCount - currentAccrualDayCount)
        const incrementalAmount = calculateDailyLateShipmentPenalty(baseAmount, incrementalDays, dailyRate)

        const totalPenaltyAmount = existing ? existing.penaltyAmount.plus(incrementalAmount) : scheduledTotal
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
          const invoice = await tx.sellerInvoice.findFirst({
            where: { sellerId, sourcePenaltyId: penalty.id, type: 'penalty' }, select: { id: true },
          })
          await ledger.createEntry({
            sellerId,
            type: 'penalty',
            amount: incrementalAmount.negated(),
            orderId: params.orderId,
            penaltyId: penalty.id,
            referenceType: 'penalty', referenceId: penalty.id,
            description:
              incrementalDays === 1
                ? `Geç sevkiyat günlük ceza birikimi: 1 gün (%${dailyRate.mul(100).toFixed(0)}) — fatura kesilince satıcı ekstresinde görünür`
                : `Geç sevkiyat günlük ceza birikimi: +${incrementalDays} gün (%${dailyRate.mul(100).toFixed(0)}/gün) — fatura kesilince satıcı ekstresinde görünür`,
            visibleToSeller: Boolean(invoice),
          }, tx)
        }

        await syncSellerPayoutBatches(tx, penalty.sellerId)
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
      return changePenalty({ ...params, reason: params.waiverReason, waive: true })
    },

    async update(params: { penaltyId: string; adminActorId: string; amount?: Decimal; reason: string }) {
      return changePenalty(params)
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
        await lockSellerFinance(tx, [params.sellerId])
        const duplicate = await tx.penalty.findFirst({ where: { orderId: params.orderId, sellerId: params.sellerId, reason: 'other' } })
        if (duplicate) return duplicate
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
          referenceType: 'penalty', referenceId: created.id,
          description: `Manuel ceza: ${params.manualReason} (fatura kesilince satıcı ekstresinde görünür)`,
          createdBy: params.adminActorId,
          visibleToSeller: false,
        }, tx)

        await createAdminAuditLogRepository(tx).createEntry({
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

        await syncSellerPayoutBatches(tx, created.sellerId)
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

      return prisma.$transaction(async tx => {
        await lockSellerFinance(tx, [penalty.sellerId])
        const current = await tx.penalty.findUnique({ where: { id: penalty.id } })
        if (!current || current.status === 'waived') return current
        const eventKey = `penalty:extension-reversal:${params.extensionRequestId}:${penalty.id}`
        if (await tx.sellerLedgerEntry.findUnique({ where: { eventKey } })) return current
        const source = await tx.sellerLedgerEntry.findFirst({
          where: { sellerId: current.sellerId, type: 'penalty', OR: [
            { referenceType: 'penalty', referenceId: current.id },
            { referenceType: 'order', referenceId: current.orderId },
          ] }, orderBy: { createdAt: 'asc' },
        })
        await ledger.createEntry({
          sellerId: current.sellerId, type: 'manual_adjustment', amount: current.penaltyAmount,
          eventKey, referenceType: source?.referenceType ?? 'penalty', referenceId: source?.referenceId ?? current.id,
          description: `Ek süre onaylandı (#${params.extensionRequestId.slice(-8).toUpperCase()}) — günlük gecikme cezası geri alındı`,
          createdBy: params.adminActorId, visibleToSeller: source?.visibleToSeller ?? false,
        }, tx)
        const updated = await tx.penalty.update({ where: { id: current.id }, data: {
          penaltyAmount: new Decimal(0), accrualDayCount: 0, rate: new Decimal(0), lastAccrualAt: null,
        } })
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: params.adminActorId, actionType: 'manual_ledger_adjustment', targetType: 'penalty', targetId: current.id,
          previousData: { penaltyAmount: current.penaltyAmount.toFixed(2) },
          newData: { penaltyAmount: '0.00', extensionRequestId: params.extensionRequestId },
          reason: 'Onaylanan ek süre nedeniyle günlük ceza geri alındı.',
        })
        await syncSellerPayoutBatches(tx, current.sellerId)
        return updated
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
