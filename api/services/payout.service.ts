/**
 * Payout Service — payout hold activation, readiness check, release.
 *
 * INVARIANTS:
 * - Payout countdown starts from delivery_confirmed ONLY.
 * - 30-day hold is mandatory after delivery_confirmed.
 * - Open return or dispute BLOCKS payout — no exceptions without admin override.
 * - All payout state changes are auditable.
 *
 * See: 07-marketplace-finance-rules.md, docs/07-operations/payout-lifecycle.md
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, PayoutBlockedError, ConflictError } from '../lib/errors'
import { createPayoutRepository } from '../repositories/payout.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createOrderLineRepository } from '../repositories/order-line.repository'
import { createSellerRepository } from '../repositories/seller.repository'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createDisputeRepository } from '../repositories/dispute.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import {
  calculateNetPayout,
  calculateHoldUntil,
  isHoldExpired,
} from '../domain/payout-calculator'

interface PayoutServiceDeps {
  prisma: PrismaClient
  systemDefaultCommissionRate?: Decimal
}

export function createPayoutService({
  prisma,
  systemDefaultCommissionRate = new Decimal('0.10'), // 10% default
}: PayoutServiceDeps) {
  const payouts = createPayoutRepository(prisma)
  const orders = createOrderRepository(prisma)
  const orderLines = createOrderLineRepository(prisma)
  const sellers = createSellerRepository(prisma)
  const returnRequests = createReturnRequestRepository(prisma)
  const disputes = createDisputeRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  return {
    /**
     * Activate payout hold after delivery_confirmed.
     * Creates the Payout record with initial deduction breakdown.
     * Called by delivery.service after delivery_confirmed transition.
     */
    async activateHold(params: {
      orderId: string
      deliveryConfirmedAt: Date
    }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      // Idempotency guard — don't create duplicate payout records
      const existing = await payouts.findByOrderId(params.orderId)
      if (existing) return existing

      const lines = await orderLines.findByOrderId(params.orderId)
      if (!lines.length) throw new ConflictError('Sipariş kalemleri bulunamadı')

      const holdUntil = calculateHoldUntil(params.deliveryConfirmedAt)

      // Create one payout per seller if multi-seller order
      const sellerIds = [...new Set(lines.map((l) => l.sellerId))]
      const created = []

      for (const sellerId of sellerIds) {
        const sellerLines = lines.filter((l) => l.sellerId === sellerId)
        const grossAmount = sellerLines.reduce(
          (sum, l) => sum.plus(l.totalPrice),
          new Decimal(0),
        )

        const commissionAmount = grossAmount.mul(systemDefaultCommissionRate).toDecimalPlaces(2)
        const couponShareAmount = new Decimal(0)
        const cargoChargeAmount = new Decimal(0)
        const adFeeAmount = new Decimal(0)
        const penaltyAmount = new Decimal(0)
        const refundAmount = new Decimal(0)
        const adjustmentAmount = new Decimal(0)

        const netAmount = calculateNetPayout({
          grossAmount,
          commissionAmount,
          couponShareAmount,
          cargoChargeAmount,
          adFeeAmount,
          penaltyAmount,
          refundAmount,
          adjustmentAmount,
        })

        const payout = await payouts.create({
          sellerId,
          orderId: params.orderId,
          grossAmount,
          commissionAmount,
          couponShareAmount,
          cargoChargeAmount,
          adFeeAmount,
          penaltyAmount,
          refundAmount,
          adjustmentAmount,
          netAmount,
          holdStartedAt: params.deliveryConfirmedAt,
          holdUntil,
        })

        created.push(payout)
      }

      return created
    },

    /**
     * Check if a payout is ready for release.
     * Returns null if blocked, or payout record if ready.
     */
    async checkReadiness(payoutId: string) {
      const payout = await payouts.findById(payoutId)
      if (!payout) throw new NotFoundError('Payout', payoutId)

      if (payout.status === 'payout_paid') return { ready: false, reason: 'already_paid' }
      if (payout.status === 'payout_blocked') return { ready: false, reason: payout.blockedReason ?? 'blocked' }

      if (!payout.holdUntil || !isHoldExpired(payout.holdUntil)) {
        return {
          ready: false,
          reason: `Hold süresi dolmadı. Bitiş: ${payout.holdUntil?.toISOString()}`,
        }
      }

      const openReturns = await returnRequests.countOpenByOrderId(payout.orderId)
      if (openReturns > 0) {
        return { ready: false, reason: 'Açık iade talebi var' }
      }

      const openDisputes = await disputes.countOpenByOrderId(payout.orderId)
      if (openDisputes > 0) {
        return { ready: false, reason: 'Açık uyuşmazlık var' }
      }

      const seller = await sellers.findActiveById(payout.sellerId)
      if (!seller) {
        return { ready: false, reason: 'Satıcı hesabı aktif değil' }
      }

      return { ready: true, payout }
    },

    /**
     * Release payout hold — admin action, fully auditable.
     * Only proceeds if readiness check passes.
     */
    async release(params: {
      payoutId: string
      adminActorId: string
      reason?: string
    }) {
      const readiness = await this.checkReadiness(params.payoutId)
      if (!readiness.ready) {
        throw new PayoutBlockedError(readiness.reason as string)
      }

      const payout = readiness.payout!
      const updated = await payouts.updateStatus(params.payoutId, 'payout_ready')

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'payout_released',
        targetType: 'payout',
        targetId: params.payoutId,
        previousData: { status: payout.status },
        newData: { status: 'payout_ready' },
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
      })

      return updated
    },

    /**
     * Block payout — admin action (open dispute, fraud, etc).
     */
    async block(params: {
      payoutId: string
      adminActorId: string
      reason: string
    }) {
      const payout = await payouts.findById(params.payoutId)
      if (!payout) throw new NotFoundError('Payout', params.payoutId)

      const updated = await payouts.block(params.payoutId, params.reason)

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'payout_blocked',
        targetType: 'payout',
        targetId: params.payoutId,
        previousData: { status: payout.status },
        newData: { status: 'payout_blocked', reason: params.reason },
        reason: params.reason,
      })

      return updated
    },

    /**
     * Mark payout as paid — called after bank transfer is processed.
     */
    async markPaid(params: {
      payoutId: string
      adminActorId: string
      batchId?: string
    }) {
      const payout = await payouts.findById(params.payoutId)
      if (!payout) throw new NotFoundError('Payout', params.payoutId)

      if (payout.status !== 'payout_ready') {
        throw new ConflictError(`Ödeme hazır değil: ${payout.status}`)
      }

      const updated = await payouts.markPaid(params.payoutId, params.batchId)

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'payout_released',
        targetType: 'payout',
        targetId: params.payoutId,
        newData: { paidAt: new Date(), ...(params.batchId !== undefined ? { batchId: params.batchId } : {}) },
      })

      return updated
    },

    listForSeller(sellerId: string, skip?: number, take?: number) {
      return payouts.listBySeller({
        sellerId,
        ...(skip !== undefined ? { skip } : {}),
        ...(take !== undefined ? { take } : {}),
      })
    },

    listForAdmin(params: Parameters<typeof payouts.listForAdmin>[0]) {
      return payouts.listForAdmin(params)
    },

    getSummaryBySeller(sellerId: string) {
      return payouts.getSummaryBySeller(sellerId)
    },
  }
}

export type PayoutService = ReturnType<typeof createPayoutService>
