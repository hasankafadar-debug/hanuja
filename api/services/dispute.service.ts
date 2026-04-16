/**
 * Dispute Service — uyuşmazlık lifecycle orchestration.
 *
 * INVARIANTS:
 * - Dispute ancak delivery_confirmed sonrası açılabilir.
 * - Aynı sipariş için aynı anda hem iade hem uyuşmazlık olmaz.
 * - Açık uyuşmazlık payout'u bloke eder.
 * - Müşteri lehine çözümde refund + payout bloğu; satıcı lehine çözümde uyuşmazlık kapanır.
 * - Her admin aksiyonu audit log'a yazılır.
 *
 * See: .claude/rules/07-marketplace-finance-rules.md, .claude/rules/08-order-lifecycle-rules.md
 */
import type { PrismaClient, UserRole } from '@prisma/client'
import { NotFoundError, ConflictError, ForbiddenError } from '../lib/errors'
import { createDisputeRepository } from '../repositories/dispute.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createPayoutRepository } from '../repositories/payout.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'

interface DisputeServiceDeps {
  prisma: PrismaClient
}

export function createDisputeService({ prisma }: DisputeServiceDeps) {
  const disputes = createDisputeRepository(prisma)
  const orders = createOrderRepository(prisma)
  const returnRequests = createReturnRequestRepository(prisma)
  const payouts = createPayoutRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  return {
    /**
     * Müşteri uyuşmazlık açar — delivery_confirmed gerekli.
     * Aynı sipariş için açık iade varsa uyuşmazlık açılamaz.
     */
    async openDispute(params: {
      orderId: string
      customerId: string
      reason: string
      description?: string
    }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.status !== 'delivery_confirmed') {
        throw new ConflictError('Uyuşmazlık ancak teslimat onayından sonra açılabilir')
      }

      // Açık iade varsa aynı anda uyuşmazlık açılamaz
      const openReturns = await returnRequests.countOpenByOrderId(params.orderId)
      if (openReturns > 0) {
        throw new ConflictError('Bu sipariş için açık bir iade talebi mevcut')
      }

      // Açık uyuşmazlık var mı?
      const existingDispute = await disputes.findByOrderId(params.orderId)
      if (existingDispute && existingDispute.status === 'open') {
        throw new ConflictError('Bu sipariş için zaten açık bir uyuşmazlık var')
      }

      const dispute = await disputes.create({
        orderId: params.orderId,
        openedById: params.customerId,
        reason: params.reason,
        ...(params.description !== undefined && { description: params.description }),
      })

      await orders.appendStatusHistory(
        params.orderId,
        'dispute_open' as never,
        params.customerId,
        `Uyuşmazlık açıldı: ${params.reason}`,
      )

      return dispute
    },

    /**
     * Admin uyuşmazlığı çözer.
     *
     * Müşteri lehine: payout bloke edilir, refund tetiklenir (çağıran katman yapar).
     * Satıcı lehine: uyuşmazlık kapanır, payout ilerleyebilir.
     */
    async resolveDispute(params: {
      disputeId: string
      adminActorId: string
      resolutionType: 'resolved_for_customer' | 'resolved_for_seller'
      resolution: string
      refundAmount?: import('@prisma/client/runtime/client').Decimal
    }) {
      const dispute = await disputes.findById(params.disputeId)
      if (!dispute) throw new NotFoundError('Dispute', params.disputeId)

      if (dispute.status !== 'open' && dispute.status !== 'under_review') {
        throw new ConflictError(`Uyuşmazlık zaten çözülmüş: ${dispute.status}`)
      }

      const isCustomerFavored = params.resolutionType === 'resolved_for_customer'

      const resolved = await disputes.resolve(params.disputeId, {
        status: params.resolutionType,
        resolvedBy: params.adminActorId,
        resolution: params.resolution,
        payoutBlocked: isCustomerFavored,
        ...(params.refundAmount !== undefined ? { refundAmount: params.refundAmount } : {}),
      })

      // Müşteri lehine ise ilgili siparişin payoutunu da bloke et
      if (isCustomerFavored) {
        const orderPayouts = await payouts.findManyByOrderId(dispute.orderId)
        for (const payout of orderPayouts) {
          if (payout.status !== 'payout_paid' && payout.status !== 'payout_blocked') {
            await payouts.block(
              payout.id,
              `Uyuşmazlık müşteri lehine çözüldü: ${params.resolution}`,
            )
          }
        }
      }

      await orders.appendStatusHistory(
        dispute.orderId,
        'dispute_resolved' as never,
        params.adminActorId,
        `Uyuşmazlık çözüldü (${isCustomerFavored ? 'müşteri lehine' : 'satıcı lehine'}): ${params.resolution}`,
      )

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'dispute_resolved',
        targetType: 'dispute',
        targetId: params.disputeId,
        previousData: { status: dispute.status },
        newData: { status: params.resolutionType, resolution: params.resolution },
        ...(params.resolution !== undefined && { reason: params.resolution }),
      })

      return resolved
    },

    /**
     * Müşteri, satıcı veya admin mesaj ekler.
     */
    async addMessage(params: {
      disputeId: string
      authorId: string
      authorRole: UserRole
      body: string
    }) {
      const dispute = await disputes.findById(params.disputeId)
      if (!dispute) throw new NotFoundError('Dispute', params.disputeId)

      if (dispute.status === 'resolved_for_customer' || dispute.status === 'resolved_for_seller' || dispute.status === 'closed') {
        throw new ConflictError('Kapalı uyuşmazlığa mesaj eklenemez')
      }

      return disputes.addMessage({
        disputeId: params.disputeId,
        authorId: params.authorId,
        authorRole: params.authorRole,
        body: params.body,
      })
    },

    getDispute(id: string) {
      return disputes.findById(id)
    },

    listForAdmin(params: Parameters<typeof disputes.listForAdmin>[0]) {
      return disputes.listForAdmin(params)
    },
  }
}

export type DisputeService = ReturnType<typeof createDisputeService>
