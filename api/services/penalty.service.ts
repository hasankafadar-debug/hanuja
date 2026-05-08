/**
 * Penalty Service — applies, offsets, and waives seller penalties.
 *
 * Standard penalty: 20% of product amount (CLAUDE.md 2.4 / 07-marketplace-finance-rules.md)
 * Applied on: seller rejection, 20-day breach cancellation.
 * Waiver: admin-only, auditable, original record preserved.
 */
import type { PrismaClient, PenaltyReason } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError } from '../lib/errors'
import { createPenaltyRepository } from '../repositories/penalty.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createOrderLineRepository } from '../repositories/order-line.repository'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createNotificationService } from './notification.service'
import {
  calculatePenalty,
} from '../domain/penalty-calculator'
import { createPlatformSettingsService } from './platform-settings.service'

interface PenaltyServiceDeps {
  prisma: PrismaClient
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
     * Evaluate and apply penalty after seller rejection or 20-day breach.
     * Called after order moves to cancelled_due_to_seller_rejection or
     * cancelled_due_to_20day_breach.
     *
     * Records penalty in seller ledger as a debit entry.
     */
    async applyForCancellation(params: {
      orderId: string
      sellerId: string
      reason: PenaltyReason
    }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      // Check if penalty already applied (idempotency)
      const existing = await penalties.findByOrderId(params.orderId)
      if (existing) return existing

      const lines = await orderLines.findByOrderIdForSeller(params.orderId, params.sellerId)
      if (!lines.length) throw new NotFoundError('OrderLine', params.orderId)

      const productAmount = lines.reduce(
        (sum, l) => sum.plus(l.totalPrice),
        new Decimal(0),
      )

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

        // Record as debit in seller ledger — negative amount
        await ledger.createEntry({
          sellerId: params.sellerId,
          type: 'penalty',
          amount: penaltyAmount.negated(),
          orderId: params.orderId,
          penaltyId: penalty.id,
          note: `Ceza: ${params.reason} — ${penaltyAmount.toFixed(2)} TRY`,
        })

        return penalty
      })
    },

    /**
     * Waive a penalty — admin only, reason required.
     * Original penalty record is PRESERVED with status='waived'.
     * Reversal ledger entry is created to cancel the debit effect.
     */
    async waive(params: {
      penaltyId: string
      adminActorId: string
      waiverReason: string
    }) {
      const penalty = await penalties.findById(params.penaltyId)
      if (!penalty) throw new NotFoundError('Penalty', params.penaltyId)

      if (penalty.status === 'waived') {
        return penalty // Idempotent
      }

      return prisma.$transaction(async (tx) => {
        const waived = await penalties.waive(params.penaltyId, {
          waivedBy: params.adminActorId,
          waiverReason: params.waiverReason,
        })

        // Reversal ledger entry — credits back the deducted amount
        await ledger.createEntry({
          sellerId: penalty.sellerId,
          type: 'manual_adjustment',
          amount: penalty.penaltyAmount, // Positive — reverses the original debit
          orderId: penalty.orderId,
          penaltyId: penalty.id,
          note: `Ceza muafiyeti: ${params.waiverReason}`,
          createdBy: params.adminActorId,
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

      const existing = await penalties.findByOrderId(params.orderId)
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
          note: `Manuel ceza: ${params.manualReason}`,
          createdBy: params.adminActorId,
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
