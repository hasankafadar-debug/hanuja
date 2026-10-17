import { recordFinalReturnDecision } from './return-decision-notification.service'
import { dispatchRefundProcessingAfterCommit } from './quantity-refund.service'
import { messageAudience, type CommunicationAudience } from '../domain/communication-audience'
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
import { recordNotification } from './notification-outbox.service'
import { allocateProductRefund, customerShippingAmount } from '../domain/quantity-allocation'
import { createPayoutService } from './payout.service'
import { isPayoutSettled } from './payout-debt.service'
import { invalidatePayoutSchedule } from './payout-eligibility'
import { syncChangedPayoutSchedules } from './payout-schedule-sync.service'
import { NotFoundError, ConflictError, ForbiddenError } from '../lib/errors'
import { createDisputeRepository } from '../repositories/dispute.repository'
import { isPersistableDisputeAuthorRole, type DisputeViewer } from '../lib/dispute-authorization'
import { createOrderRepository } from '../repositories/order.repository'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createPayoutRepository } from '../repositories/payout.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createRefundService } from './refund.service'
import { adminPanelLink, recordAdminOperationNotification } from './admin-notification.service'
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

      // Dispute, its history entry and the operations notification commit
      // together: a crash in between must not leave a dispute nobody is told about.
      return prisma.$transaction(async (tx) => {
        const dispute = await disputes.create(
          {
            orderId: params.orderId,
            openedById: params.customerId,
            reason: params.reason,
            ...(params.description !== undefined && {
              description: params.description,
            }),
          },
          tx as PrismaClient,
        )

        await orders.appendStatusHistory(
          params.orderId,
          'dispute_open' as never,
          params.customerId,
          `Uyuşmazlık açıldı: ${params.reason}`,
          tx as PrismaClient,
        )

        await recordAdminOperationNotification(tx, {
          event: 'dispute_opened',
          type: 'admin_dispute_opened',
          eventKey: `dispute:${dispute.id}:ops`,
          title: 'Müşteri uyuşmazlık açtı',
          body: `#${order.publicNumber} siparişi için uyuşmazlık açıldı: ${params.reason}`,
          data: {
            orderNumber: String(order.publicNumber),
            adminUrl: adminPanelLink(`/uyusmazliklar/${dispute.id}`),
            reason: params.description ? `${params.reason} — ${params.description}` : params.reason,
            sourceLabel: 'Müşteri uyuşmazlık açtı',
          },
        })

        await invalidatePayoutSchedule(tx, params.orderId)
        return dispute
      })
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
      const result = await prisma.$transaction(
        async (tx) => {
          const initial = await tx.dispute.findUnique({
            where: { id: params.disputeId },
            select: { orderId: true },
          })
          if (!initial) throw new NotFoundError('Dispute', params.disputeId)
          await tx.$queryRaw`SELECT id FROM orders WHERE id = ${initial.orderId} FOR UPDATE`
          const scoped = tx as unknown as PrismaClient
          const disputes = createDisputeRepository(scoped)
          const orders = createOrderRepository(scoped)
          const auditLog = createAdminAuditLogRepository(scoped)
          const quantityRefunds = createQuantityRefundService({
            prisma: scoped,
          })
          const legacyRefunds = createRefundService({ prisma: scoped })
          const dispute = await disputes.findByIdForAdmin(params.disputeId)
          if (!dispute) throw new NotFoundError('Dispute', params.disputeId)

          if (dispute.status !== 'open' && dispute.status !== 'under_review') {
            if (
              dispute.status === params.resolutionType &&
              dispute.resolution === params.resolution
            )
              return dispute
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

          // İade reddinden eskale edilen uyuşmazlık müşteri lehine çözülürse
          // gerçek para iadesi tetiklenir (idempotent — refund.service).
          if (rr && isCustomerFavored && (rr.items.length > 0 || !rr.refundedAt)) {
            if (rr.items.length > 0 && rr.sellerId) {
              const remainingItems = rr.items
                .filter((item) => item.rejectedQuantity > 0)
                .map((item) => ({
                  item,
                  amounts: allocateProductRefund(
                    {
                      quantity: item.requestedQuantity,
                      totalPrice: item.requestedGrossProductAmount,
                      customerPaidProductAmount: item.requestedCustomerAmount,
                      couponDiscountAmount: item.requestedCouponAdjustmentAmount,
                      commissionAmount: item.requestedCommissionAdjustmentAmount,
                      commissionExemptedAt: item.orderLine.commissionExemptedAt,
                    },
                    item.acceptedQuantity,
                    item.rejectedQuantity,
                  ),
                }))
              const total = (key: keyof (typeof remainingItems)[number]['amounts']) =>
                remainingItems.reduce((sum, entry) => sum.add(entry.amounts[key]), new Decimal(0))
              let customerAmount = total('customerAmount')
              const sellerAdjustmentAmount = total('sellerAmount')
              const grossProductAmount = total('grossAmount')
              const couponAdjustmentAmount = total('couponAmount')
              const commissionAdjustmentAmount = total('commissionAmount')
              const shippingRefund = await (async () => {
                const lineTotals = await tx.orderLine.aggregate({
                  where: { orderId: rr.orderId },
                  _sum: { quantity: true, cancelledQuantity: true },
                })
                const acceptedTotals = await tx.returnRequestItem.aggregate({
                  where: { orderLine: { orderId: rr.orderId } },
                  _sum: { acceptedQuantity: true },
                })
                const disputeResolvedTotals = await tx.returnRequestItem.aggregate({
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
                    customerPaidShippingAmount: true,
                    refundedShippingAmount: true,
                  },
                })
                const remainingShipping = customerShippingAmount(order).sub(
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
              })()
              customerAmount = customerAmount.add(shippingRefund)
              if (customerAmount.gt(0) || grossProductAmount.gt(0)) {
                await quantityRefunds.queue(
                  {
                    orderId: rr.orderId,
                    sellerId: rr.sellerId,
                    sourceType: 'dispute',
                    sourceId: dispute.id,
                    customerAmount,
                    grossProductAmount,
                    couponAdjustmentAmount,
                    sellerAdjustmentAmount,
                    commissionAdjustmentAmount,
                    platformFundedAmount: Decimal.max(
                      new Decimal(0),
                      customerAmount.sub(sellerAdjustmentAmount).sub(commissionAdjustmentAmount),
                    ),
                    items: remainingItems.map(({ item, amounts }) => ({
                      orderLineId: item.orderLineId,
                      quantity: item.rejectedQuantity,
                      amount: amounts.customerAmount,
                    })),
                    shippingAmount: shippingRefund,
                  },
                  tx,
                )
                await tx.returnRequest.update({
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
                throw new ConflictError(
                  'Eski iade birden fazla tasarımcıya ait; otomatik iade yapılamaz',
                )
              }
              const sellerId = sellerIds[0]!
              const refundAmount =
                params.refundAmount ??
                roundMoney(
                  rr.order.lines
                    .filter((l) => l.sellerId === sellerId)
                    .reduce((s, l) => s.plus(new Decimal(l.totalPrice)), new Decimal(0)),
                )
              await legacyRefunds.executeReturnRefundInTransaction(tx, {
                returnRequestId: rr.id,
                orderId: rr.orderId,
                sellerId,
                refundAmount,
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
            `Uyuşmazlık çözüldü (${isCustomerFavored ? 'müşteri lehine' : 'tasarımcı lehine'}): ${params.resolution}`,
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
            ...(params.resolution !== undefined && {
              reason: params.resolution,
            }),
          })

          if (rr) {
            await tx.returnRequest.update({
              where: { id: rr.id },
              data: {
                reviewedAt: new Date(),
                reviewedBy: params.adminActorId,
                reviewNote: params.resolution,
                ...(!isCustomerFavored ? { status: 'rejected' as const } : {}),
              },
            })
            await tx.returnMessage.create({
              data: {
                returnRequestId: rr.id,
                authorId: params.adminActorId,
                authorRole: 'admin',
                audience: 'customer',
                body: params.resolution,
              },
            })
            await recordFinalReturnDecision(tx, {
              id: rr.id,
              orderId: dispute.orderId,
              sellerId: rr.sellerId,
              approved: isCustomerFavored,
              partialDecision:
                rr.items.some((item) => item.acceptedQuantity > 0) &&
                rr.items.some((item) => item.rejectedQuantity > 0),
              resolution: params.resolution,
              eventKey: 'dispute:' + dispute.id + ':resolved',
            })
          }
          await invalidatePayoutSchedule(tx, dispute.orderId)
          return resolved
        },
        { timeout: 30_000 },
      )
      await syncChangedPayoutSchedules(prisma, { orderId: result.orderId })
      const refunds = await prisma.refundTransaction.findMany({
        where: { sourceType: 'dispute', sourceId: result.id },
        include: { payment: true },
      })
      for (const refund of refunds) await dispatchRefundProcessingAfterCommit(refund)
      return result
    },

    /**
     * Müşteri, satıcı veya admin mesaj ekler.
     */
    async addMessage(params: {
      disputeId: string
      viewer: DisputeViewer
      body: string
      audience?: CommunicationAudience
    }) {
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
        audience: messageAudience(params.viewer.viewerRole, params.audience),
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
