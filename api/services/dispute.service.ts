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
import type { PrismaClient } from '@prisma/client'
import { NotFoundError, ConflictError, ForbiddenError } from '../lib/errors'
import { createDisputeRepository } from '../repositories/dispute.repository'
import { isPersistableDisputeAuthorRole, type DisputeViewer } from '../lib/dispute-authorization'
import { createOrderRepository } from '../repositories/order.repository'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createPayoutRepository } from '../repositories/payout.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createRefundService } from './refund.service'
import { createQuantityRefundService } from './quantity-refund.service'
import { assertTransition } from '../domain/order-state-machine'
import { assertNoContactSharing } from './contact-sharing-guard.service'
import { roundMoney } from '@hanuja/security/money'
import { Decimal } from '@prisma/client/runtime/client'

interface DisputeServiceDeps {
  prisma: PrismaClient
}

export function createDisputeService({ prisma }: DisputeServiceDeps) {
  const disputes = createDisputeRepository(prisma)
  const orders = createOrderRepository(prisma)
  const returnRequests = createReturnRequestRepository(prisma)
  const payouts = createPayoutRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)
  const legacyRefunds = createRefundService({ prisma })
  const quantityRefunds = createQuantityRefundService({ prisma })

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
        ...(params.description !== undefined && {
          description: params.description,
        }),
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
      const dispute = await disputes.findByIdForAdmin(params.disputeId)
      if (!dispute) throw new NotFoundError('Dispute', params.disputeId)

      if (dispute.status !== 'open' && dispute.status !== 'under_review') {
        throw new ConflictError(`Uyuşmazlık zaten çözülmüş: ${dispute.status}`)
      }

      const isCustomerFavored = params.resolutionType === 'resolved_for_customer'
      const rr = dispute.escalatedFromReturn

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
        const affectedPayouts = rr?.sellerId
          ? orderPayouts.filter((payout) => payout.sellerId === rr.sellerId)
          : orderPayouts
        for (const payout of affectedPayouts) {
          if (payout.status !== 'payout_paid' && payout.status !== 'payout_blocked') {
            await payouts.block(
              payout.id,
              `Uyuşmazlık müşteri lehine çözüldü: ${params.resolution}`,
            )
          }
        }
      }

      // İade reddinden eskale edilen uyuşmazlık müşteri lehine çözülürse
      // gerçek para iadesi tetiklenir (idempotent — refund.service).
      if (rr && isCustomerFavored && (rr.items.length > 0 || !rr.refundedAt)) {
        if (rr.items.length > 0 && rr.sellerId) {
          let customerAmount = rr.items.reduce(
            (sum, item) => sum.add(item.requestedCustomerAmount.sub(item.customerRefundAmount)),
            new Decimal(0),
          )
          const sellerAdjustmentAmount = rr.items.reduce(
            (sum, item) =>
              sum.add(
                item.requestedSellerAdjustmentAmount.sub(item.sellerAdjustmentAmount),
              ),
            new Decimal(0),
          )
          const commissionAdjustmentAmount = rr.items.reduce(
            (sum, item) =>
              sum.add(
                item.requestedCommissionAdjustmentAmount.sub(
                  item.commissionAdjustmentAmount,
                ),
              ),
            new Decimal(0),
          )
          const shippingRefund = await prisma.$transaction(async (tx) => {
            const lineTotals = await tx.orderLine.aggregate({
              where: { orderId: rr.orderId },
              _sum: { quantity: true, cancelledQuantity: true },
            })
            const acceptedTotals = await tx.returnRequestItem.aggregate({
              where: { orderLine: { orderId: rr.orderId } },
              _sum: { acceptedQuantity: true },
            })
            const disputeResolvedTotals =
              await tx.returnRequestItem.aggregate({
                where: {
                  orderLine: { orderId: rr.orderId },
                  returnRequest: {
                    escalatedDispute: {
                      is: { status: 'resolved_for_customer' },
                    },
                  },
                },
                _sum: { rejectedQuantity: true },
              })
            const originalQuantity = lineTotals._sum.quantity ?? 0
            const closedQuantity =
              (lineTotals._sum.cancelledQuantity ?? 0) +
              (acceptedTotals._sum.acceptedQuantity ?? 0) +
              (disputeResolvedTotals._sum.rejectedQuantity ?? 0)
            if (originalQuantity <= 0 || closedQuantity < originalQuantity) {
              return new Decimal(0)
            }

            const order = await tx.order.findUniqueOrThrow({
              where: { id: rr.orderId },
              select: {
                shippingAmount: true,
                refundedShippingAmount: true,
              },
            })
            const remainingShipping = order.shippingAmount.sub(
              order.refundedShippingAmount,
            )
            if (remainingShipping.lte(0)) return new Decimal(0)
            await tx.order.update({
              where: { id: rr.orderId },
              data: {
                refundedShippingAmount: { increment: remainingShipping },
              },
            })
            return remainingShipping
          })
          customerAmount = customerAmount.add(shippingRefund)
          if (customerAmount.gt(0)) {
            await quantityRefunds.queue({
              orderId: rr.orderId,
              sellerId: rr.sellerId,
              sourceType: 'dispute',
              sourceId: dispute.id,
              customerAmount,
              sellerAdjustmentAmount,
              commissionAdjustmentAmount,
              platformFundedAmount: Decimal.max(
                new Decimal(0),
                customerAmount.sub(sellerAdjustmentAmount),
              ),
            })
            await prisma.returnRequest.update({
              where: { id: rr.id },
              data: {
                status: 'received',
                refundAmount: { increment: customerAmount },
              },
            })
          }
        } else {
          const sellerIds = [...new Set(rr.order.lines.map((l) => l.sellerId))]
          if (sellerIds.length !== 1) {
            throw new ConflictError('Eski iade birden fazla satıcıya ait; otomatik iade yapılamaz')
          }
          const sellerId = sellerIds[0]!
          const refundAmount =
            params.refundAmount ??
            roundMoney(
              rr.order.lines
                .filter((l) => l.sellerId === sellerId)
                .reduce((s, l) => s.plus(new Decimal(l.totalPrice)), new Decimal(0)),
            )
          await legacyRefunds.executeReturnRefund({
            returnRequestId: rr.id,
            orderId: rr.orderId,
            sellerId,
            refundAmount,
            payments: rr.order.payments.map((p) => ({
              method: p.method,
              id: p.id,
              providerPaymentId: p.providerPaymentId,
            })),
            actorRef: `admin_${params.adminActorId}`,
          })
        }
      }

      // Sipariş durumunu dispute_resolved'a taşı (yalnızca dispute_open ise)
      const order = await orders.findById(dispute.orderId)
      if (order && order.status === 'dispute_open') {
        assertTransition(order.status, 'dispute_resolved')
        await orders.updateStatus(dispute.orderId, 'dispute_resolved')
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
        newData: {
          status: params.resolutionType,
          resolution: params.resolution,
        },
        ...(params.resolution !== undefined && { reason: params.resolution }),
      })

      return resolved
    },

    /**
     * Müşteri, satıcı veya admin mesaj ekler.
     */
    async addMessage(params: { disputeId: string; viewer: DisputeViewer; body: string }) {
      const dispute = await disputes.findMessageTargetForViewer(params.disputeId, params.viewer)
      if (!dispute) throw new NotFoundError('Dispute', params.disputeId)

      // The current persisted enum has no `support` author role. Support may
      // inspect cases through its view-all permission, but cannot be recorded
      // under another role when posting a message.
      if (!isPersistableDisputeAuthorRole(params.viewer.viewerRole)) {
        throw new ForbiddenError('Bu rol uyusmazlik mesaji olusturamaz')
      }

      if (
        dispute.status === 'resolved_for_customer' ||
        dispute.status === 'resolved_for_seller' ||
        dispute.status === 'closed'
      ) {
        throw new ConflictError('Kapalı uyuşmazlığa mesaj eklenemez')
      }

      assertNoContactSharing(params.body)

      return disputes.addMessage({
        disputeId: params.disputeId,
        authorId: params.viewer.viewerId,
        authorRole: params.viewer.viewerRole,
        body: params.body,
      })
    },

    async getDispute(id: string, viewer: DisputeViewer) {
      const dispute = await disputes.findByIdForViewer(id, viewer)
      if (!dispute) throw new NotFoundError('Dispute', id)
      return dispute
    },

    listForAdmin(params: Parameters<typeof disputes.listForAdmin>[0]) {
      return disputes.listForAdmin(params)
    },
  }
}

export type DisputeService = ReturnType<typeof createDisputeService>
