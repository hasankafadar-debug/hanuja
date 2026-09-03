/**
 * Return Service — seller-driven return lifecycle (08-order-lifecycle-rules.md).
 *
 * Flow:
 *   customer openRequest (within 14 calendar days — HARD cutoff)
 *     → seller provideSellerCargoInfo (status approved)
 *     → customer submitCustomerShipment (status in_transit)
 *     → seller confirmReceiptBySeller → AUTO refund → refund_completed
 *        OR seller rejectReceiptBySeller → auto-open Dispute (escalate to admin)
 *
 * Open return BLOCKS payout — no exceptions without explicit resolution.
 * Refund money movement is finance-sensitive: idempotent, ledger-tracked.
 */
import type { PrismaClient, UserRole } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../lib/errors'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createDisputeRepository } from '../repositories/dispute.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createNotificationService } from './notification.service'
import { createRefundService } from './refund.service'
import { isWithinReturnWindow } from '../domain/penalty-calculator'
import { assertTransition } from '../domain/order-state-machine'
import { assertNoContactSharing } from './contact-sharing-guard.service'
import { roundMoney } from '@hanuja/security/money'

interface ReturnServiceDeps {
  prisma: PrismaClient
}

export function createReturnService({ prisma }: ReturnServiceDeps) {
  const returnRequests = createReturnRequestRepository(prisma)
  const orders = createOrderRepository(prisma)
  const disputes = createDisputeRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)
  const notifications = createNotificationService({ prisma })
  const refunds = createRefundService({ prisma })

  /** Resolve a seller's auth userId for notifications. */
  async function sellerUserId(sellerId: string): Promise<string | null> {
    const seller = await prisma.seller.findUnique({
      where: { id: sellerId },
      select: { userId: true },
    })
    return seller?.userId ?? null
  }

  /** Attach uploaded media to a return request / message — ownership enforced. */
  async function linkAssets(
    assetIds: string[],
    ownerUserId: string,
    patch: { returnRequestId?: string; returnMessageId?: string },
  ) {
    if (assetIds.length === 0) return
    await prisma.mediaAsset.updateMany({
      where: { id: { in: assetIds }, uploadedBy: ownerUserId },
      data: { ...patch, type: 'return_evidence' },
    })
  }

  /** The seller that owns lines on this order (single-seller assumption). */
  function resolveOrderSellerId(
    lines: { sellerId: string }[],
    requireSellerId?: string,
  ): string {
    const sellerIds = [...new Set(lines.map((l) => l.sellerId))]
    if (requireSellerId) {
      if (!sellerIds.includes(requireSellerId)) {
        throw new ForbiddenError('Bu iade talebi sizin siparişinize ait değil')
      }
      return requireSellerId
    }
    if (sellerIds.length !== 1) {
      throw new ConflictError('Çok satıcılı sipariş iadesi henüz desteklenmiyor')
    }
    return sellerIds[0]!
  }

  return {
    /**
     * Customer opens a return request — only within the 14 calendar-day window.
     * After the window the path is fully closed (locked policy decision).
     */
    async openRequest(params: {
      orderId: string
      customerId: string
      reason: string
      description?: string
      evidenceAssetIds?: string[]
    }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.quantityLifecycleVersion === 2) {
        throw new ConflictError('Bu siparişte ürün ve adet seçerek iade talebi oluşturun')
      }

      if (!order.deliveryConfirmedAt) {
        throw new ConflictError('Teslim onaylanmadan iade talebi açılamaz')
      }

      const isWithinWindow = isWithinReturnWindow(order.deliveryConfirmedAt)
      if (!isWithinWindow) {
        throw new ConflictError(
          'İade süresi doldu — teslim onayından sonraki 14 günlük iade hakkı sona erdi',
        )
      }

      const existing = await returnRequests.countOpenByOrderId(params.orderId)
      if (existing > 0) {
        throw new ConflictError('Bu sipariş için zaten açık bir iade talebi var')
      }

      const returnRequest = await returnRequests.create({
        orderId: params.orderId,
        customerId: params.customerId,
        reason: params.reason,
        ...(params.description !== undefined && { description: params.description }),
        isWithinWindow,
      })

      if (params.evidenceAssetIds?.length) {
        await linkAssets(params.evidenceAssetIds, params.customerId, {
          returnRequestId: returnRequest.id,
        })
      }

      assertTransition(order.status, 'return_requested')
      await orders.updateStatus(params.orderId, 'return_requested')
      await orders.appendStatusHistory(
        params.orderId,
        'return_requested',
        params.customerId,
        `İade talebi: ${params.reason}`,
      )

      // Notify seller(s) that own lines on this order
      const sellerIds = [...new Set(order.lines.map((l) => l.sellerId))]
      for (const sid of sellerIds) {
        const uid = await sellerUserId(sid)
        if (uid) {
          await notifications.send({
            userId: uid,
            type: 'seller_return_request',
            title: 'Yeni İade Talebi',
            body: `#${order.publicNumber} siparişi için iade talebi açıldı. İade kargo bilgisini girmeniz bekleniyor.`,
            data: { orderId: params.orderId, returnRequestId: returnRequest.id },
          })
        }
      }

      return returnRequest
    },

    /**
     * Seller provides the return cargo instructions to the customer.
     * Within the legal window the return is a customer right — the seller
     * cannot reject the request here, only provide cargo info.
     */
    async provideSellerCargoInfo(params: {
      returnRequestId: string
      sellerId: string
      address: string
      carrier: string
      instructions?: string
    }) {
      const rr = await returnRequests.findByIdForSeller(
        params.returnRequestId,
        params.sellerId,
      )
      if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)
      if (rr.status !== 'requested' && rr.status !== 'under_review') {
        throw new ConflictError(`İade bu aşamada kargo bilgisi kabul etmiyor: ${rr.status}`)
      }

      const updated = await returnRequests.setSellerCargoInfo(params.returnRequestId, {
        address: params.address,
        carrier: params.carrier,
        ...(params.instructions !== undefined && { instructions: params.instructions }),
      })

      assertTransition(rr.order.status, 'return_approved')
      await orders.updateStatus(rr.orderId, 'return_approved')
      await orders.appendStatusHistory(
        rr.orderId,
        'return_approved',
        `seller_${params.sellerId}`,
        'Satıcı iade kargo bilgilerini iletti',
      )

      await notifications.send({
        userId: rr.customerId,
        type: 'return_status_changed',
        title: 'İade Kargo Bilgileri Hazır',
        body: 'Satıcı iade kargo bilgilerini iletti. Ürünü kargoya verip kargo bilgilerini girebilirsiniz.',
        data: { orderId: rr.orderId, returnRequestId: rr.id },
      })

      return updated
    },

    /**
     * Customer ships the item back and provides tracking and/or a cargo
     * barcode photo. Either a tracking number or a barcode asset is required.
     */
    async submitCustomerShipment(params: {
      returnRequestId: string
      customerId: string
      carrier: string
      trackingNumber?: string
      barcodeAssetId?: string
    }) {
      const rr = await returnRequests.findByIdWithOrder(params.returnRequestId)
      if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)
      if (rr.customerId !== params.customerId) {
        throw new ForbiddenError('Bu iade talebi size ait değil')
      }
      if (rr.status !== 'approved') {
        throw new ConflictError(`İade bu aşamada kargo bilgisi kabul etmiyor: ${rr.status}`)
      }
      if (!params.trackingNumber && !params.barcodeAssetId) {
        throw new ValidationError(
          'Kargo takip numarası veya kargo barkod görseli gerekli',
        )
      }

      const updated = await returnRequests.setCustomerShipment(params.returnRequestId, {
        carrier: params.carrier,
        ...(params.trackingNumber !== undefined && {
          trackingNumber: params.trackingNumber,
        }),
      })

      if (params.barcodeAssetId) {
        await linkAssets([params.barcodeAssetId], params.customerId, {
          returnRequestId: rr.id,
        })
      }

      assertTransition(rr.order.status, 'return_in_transit')
      await orders.updateStatus(rr.orderId, 'return_in_transit')
      await orders.appendStatusHistory(
        rr.orderId,
        'return_in_transit',
        params.customerId,
        `Müşteri ürünü kargoya verdi (${params.carrier})`,
      )

      const sid = resolveOrderSellerId(rr.order.lines)
      const uid = await sellerUserId(sid)
      if (uid) {
        await notifications.send({
          userId: uid,
          type: 'return_status_changed',
          title: 'İade Kargoya Verildi',
          body: 'Müşteri iade ürününü kargoya verdi. Ürün size ulaştığında onaylayın veya reddedin.',
          data: { orderId: rr.orderId, returnRequestId: rr.id },
        })
      }

      return updated
    },

    /**
     * Seller confirms physical receipt → triggers the customer refund
     * automatically (locked policy decision). Finance-sensitive + idempotent.
     */
    async confirmReceiptBySeller(params: {
      returnRequestId: string
      sellerId: string
    }) {
      const rr = await returnRequests.findByIdForSeller(
        params.returnRequestId,
        params.sellerId,
      )
      if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)
      if (rr.items.length > 0) {
        throw new ConflictError('Bu iade için ürün/adet bazlı teslim kararı kullanılmalıdır')
      }
      if (rr.status !== 'in_transit') {
        throw new ConflictError(`İade bu aşamada teslim onayı kabul etmiyor: ${rr.status}`)
      }

      const sellerId = resolveOrderSellerId(rr.order.lines, params.sellerId)
      const refundAmount = roundMoney(
        rr.order.lines
          .filter((l) => l.sellerId === sellerId)
          .reduce((sum, l) => sum.plus(new Decimal(l.totalPrice)), new Decimal(0)),
      )

      await returnRequests.setSellerReceived(params.returnRequestId)

      assertTransition(rr.order.status, 'return_received')
      await orders.updateStatus(rr.orderId, 'return_received')
      await orders.appendStatusHistory(
        rr.orderId,
        'return_received',
        `seller_${params.sellerId}`,
        'Satıcı iade ürününü teslim aldı ve onayladı',
      )
      assertTransition('return_received', 'refund_pending')
      await orders.updateStatus(rr.orderId, 'refund_pending')

      await refunds.executeReturnRefund({
        returnRequestId: rr.id,
        orderId: rr.orderId,
        sellerId,
        refundAmount,
        payments: rr.order.payments.map((p) => ({
          method: p.method,
          id: p.id,
          providerPaymentId: p.providerPaymentId,
        })),
        actorRef: `seller_${params.sellerId}`,
      })

      return returnRequests.findById(rr.id)
    },

    /**
     * Seller rejects the received item (wrong/damaged) → auto-open an admin
     * Dispute and keep the conversation continuous. The customer can keep
     * replying with text + images on the same return thread.
     */
    async rejectReceiptBySeller(params: {
      returnRequestId: string
      sellerId: string
      reason: string
      description?: string
      evidenceAssetIds?: string[]
    }) {
      const rr = await returnRequests.findByIdForSeller(
        params.returnRequestId,
        params.sellerId,
      )
      if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)
      if (rr.items.length > 0) {
        throw new ConflictError('Bu iade için ürün/adet bazlı teslim kararı kullanılmalıdır')
      }
      if (rr.status !== 'in_transit') {
        throw new ConflictError(`İade bu aşamada reddedilemez: ${rr.status}`)
      }

      await returnRequests.setSellerRejected(params.returnRequestId, {
        reason: params.reason,
        ...(params.description !== undefined && { description: params.description }),
      })

      const sellerUid = await sellerUserId(params.sellerId)
      if (params.evidenceAssetIds?.length && sellerUid) {
        await linkAssets(params.evidenceAssetIds, sellerUid, {
          returnRequestId: rr.id,
        })
      }

      assertTransition(rr.order.status, 'return_rejected')
      await orders.updateStatus(rr.orderId, 'return_rejected')
      await orders.appendStatusHistory(
        rr.orderId,
        'return_rejected',
        `seller_${params.sellerId}`,
        `Satıcı iadeyi reddetti: ${params.reason}`,
      )

      // Auto-escalate to an admin dispute (payoutBlocked defaults true)
      const dispute = await disputes.create({
        orderId: rr.orderId,
        openedById: sellerUid ?? `seller_${params.sellerId}`,
        reason: `Satıcı iade reddi: ${params.reason}`,
        ...(params.description !== undefined && { description: params.description }),
      })
      await returnRequests.linkDispute(rr.id, dispute.id)

      assertTransition('return_rejected', 'dispute_open')
      await orders.updateStatus(rr.orderId, 'dispute_open')
      await orders.appendStatusHistory(
        rr.orderId,
        'dispute_open' as never,
        `seller_${params.sellerId}`,
        'İade reddi uyuşmazlığa taşındı',
      )

      // Notify customer + admins
      await notifications.send({
        userId: rr.customerId,
        type: 'return_status_changed',
        title: 'İadeniz Reddedildi — Uyuşmazlık Açıldı',
        body: `Satıcı iadeyi reddetti: ${params.reason}. Konu admin uyuşmazlık incelemesine taşındı, cevap yazabilirsiniz.`,
        data: { orderId: rr.orderId, returnRequestId: rr.id, disputeId: dispute.id },
      })
      const admins = await prisma.user.findMany({
        where: { role: 'admin' },
        select: { id: true },
      })
      for (const a of admins) {
        await notifications.send({
          userId: a.id,
          type: 'admin_dispute_opened',
          title: 'Yeni Uyuşmazlık (İade Reddi)',
          body: `#${params.returnRequestId.slice(-8)} iadesi satıcı tarafından reddedildi ve uyuşmazlığa taşındı.`,
          data: { orderId: rr.orderId, returnRequestId: rr.id, disputeId: dispute.id },
        })
      }

      return returnRequests.findById(rr.id)
    },

    /**
     * Admin reviews and approves/rejects the return request (override path).
     */
    async reviewRequest(params: {
      returnRequestId: string
      adminActorId: string
      decision: 'approved' | 'rejected'
      reviewNote?: string
    }) {
      const returnRequest = await returnRequests.findById(params.returnRequestId)
      if (!returnRequest) throw new NotFoundError('ReturnRequest', params.returnRequestId)
      if (returnRequest.items.length > 0) {
        throw new ConflictError('Adet bazlı iadeler satıcı teslim kararı veya uyuşmazlık akışıyla yönetilir')
      }

      const newStatus = params.decision === 'approved' ? 'approved' : 'rejected'

      const updated = await returnRequests.review(params.returnRequestId, {
        status: newStatus,
        reviewedBy: params.adminActorId,
        ...(params.reviewNote !== undefined && { reviewNote: params.reviewNote }),
      })

      if (params.decision === 'approved') {
        await orders.updateStatus(returnRequest.orderId, 'return_approved')
        await orders.appendStatusHistory(
          returnRequest.orderId,
          'return_approved',
          params.adminActorId,
          params.reviewNote ?? 'İade onaylandı',
        )
      } else {
        await orders.updateStatus(returnRequest.orderId, 'return_rejected')
        await orders.appendStatusHistory(
          returnRequest.orderId,
          'return_rejected',
          params.adminActorId,
          params.reviewNote ?? 'İade reddedildi',
        )
      }

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: params.decision === 'approved' ? 'return_approved' : 'return_rejected',
        targetType: 'return_request',
        targetId: params.returnRequestId,
        previousData: { status: returnRequest.status },
        newData: { status: newStatus },
        ...(params.reviewNote !== undefined && { reason: params.reviewNote }),
      })

      return updated
    },

    /**
     * Mark item received and trigger refund — admin override action.
     * Uses the shared idempotent executeRefund.
     */
    async markItemReceived(params: {
      returnRequestId: string
      adminActorId: string
      refundAmount: Decimal
      adminIp?: string
    }) {
      const rr = await returnRequests.findByIdWithOrder(params.returnRequestId)
      if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)
      if (rr.items.length > 0) {
        throw new ConflictError('Adet bazlı iade bu eski admin akışıyla tamamlanamaz')
      }

      await orders.updateStatus(rr.orderId, 'return_received')
      await orders.updateStatus(rr.orderId, 'refund_pending')

      const sellerId = resolveOrderSellerId(rr.order.lines)
      await refunds.executeReturnRefund({
        returnRequestId: rr.id,
        orderId: rr.orderId,
        sellerId,
        refundAmount: params.refundAmount,
        payments: rr.order.payments.map((p) => ({
          method: p.method,
          id: p.id,
          providerPaymentId: p.providerPaymentId,
        })),
        actorRef: `admin_${params.adminActorId}`,
        ...(params.adminIp !== undefined && { ip: params.adminIp }),
      })

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'return_approved',
        targetType: 'return_request',
        targetId: params.returnRequestId,
        previousData: { status: rr.status },
        newData: { status: 'refund_pending', refundAmount: params.refundAmount },
        reason: `İade alındı, ${params.refundAmount.toFixed(2)} TRY iade başlatıldı`,
      })

      return returnRequests.findById(rr.id)
    },

    /**
     * Müşteri, satıcı veya admin iade talebine mesaj ekler — opsiyonel ek görsel.
     * Konuşma reddedildikten/uyuşmazlığa taşındıktan sonra da devam eder;
     * yalnızca refund_completed terminal durumunda kapanır.
     */
    async addMessage(params: {
      returnRequestId: string
      authorId: string
      authorRole: UserRole
      body: string
      attachmentAssetIds?: string[]
    }) {
      const rr = await returnRequests.findById(params.returnRequestId)
      if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)

      if (rr.status === 'refund_completed') {
        throw new ConflictError('Tamamlanmış iade talebine mesaj eklenemez')
      }

      assertNoContactSharing(params.body)

      const message = await prisma.returnMessage.create({
        data: {
          returnRequestId: params.returnRequestId,
          authorId: params.authorId,
          authorRole: params.authorRole,
          body: params.body,
        },
      })

      if (params.attachmentAssetIds?.length) {
        await linkAssets(params.attachmentAssetIds, params.authorId, {
          returnMessageId: message.id,
        })
      }

      return prisma.returnMessage.findUnique({
        where: { id: message.id },
        include: { attachments: true },
      })
    },

    getRequest(id: string) {
      return returnRequests.findByIdWithOrder(id)
    },

    getRequestForSeller(id: string, sellerId: string) {
      return returnRequests.findByIdForSeller(id, sellerId)
    },

    listForAdmin(params: Parameters<typeof returnRequests.listForAdmin>[0]) {
      return returnRequests.listForAdmin(params)
    },

    listForSeller(params: Parameters<typeof returnRequests.listForSeller>[0]) {
      return returnRequests.listForSeller(params)
    },
  }
}

export type ReturnService = ReturnType<typeof createReturnService>
