/**
 * Return Service — return request lifecycle.
 *
 * 14-day fast path: within window → standard handling.
 * After 14 days: requires admin evaluation.
 * Open return BLOCKS payout — no exceptions without explicit resolution.
 */
import type { PrismaClient, UserRole } from '@prisma/client'
import { NotFoundError, ConflictError } from '../lib/errors'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { isWithinReturnWindow } from '../domain/penalty-calculator'
import { assertTransition } from '../domain/order-state-machine'
import { refundPayment as iyzicoRefund } from '../lib/iyzico'
import { assertNoContactSharing } from './contact-sharing-guard.service'

interface ReturnServiceDeps {
  prisma: PrismaClient
}

export function createReturnService({ prisma }: ReturnServiceDeps) {
  const returnRequests = createReturnRequestRepository(prisma)
  const orders = createOrderRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  return {
    /**
     * Customer opens a return request.
     * isWithinWindow is determined by delivery_confirmed date.
     */
    async openRequest(params: {
      orderId: string
      customerId: string
      reason: string
      description?: string
    }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (!order.deliveryConfirmedAt) {
        throw new ConflictError('Teslim onaylanmadan iade talebi açılamaz')
      }

      // Check if already has open return
      const existing = await returnRequests.countOpenByOrderId(params.orderId)
      if (existing > 0) {
        throw new ConflictError('Bu sipariş için zaten açık bir iade talebi var')
      }

      const isWithinWindow = isWithinReturnWindow(order.deliveryConfirmedAt)

      const returnRequest = await returnRequests.create({
        orderId: params.orderId,
        customerId: params.customerId,
        reason: params.reason,
        ...(params.description !== undefined && { description: params.description }),
        isWithinWindow,
      })

      // Transition order to return_requested
      assertTransition(order.status, 'return_requested')
      await orders.updateStatus(params.orderId, 'return_requested')
      await orders.appendStatusHistory(
        params.orderId,
        'return_requested',
        params.customerId,
        `İade talebi: ${params.reason}${isWithinWindow ? ' (14 gün içinde)' : ' (14 gün sonra)'}`,
      )

      return returnRequest
    },

    /**
     * Admin reviews and approves/rejects the return request.
     */
    async reviewRequest(params: {
      returnRequestId: string
      adminActorId: string
      decision: 'approved' | 'rejected'
      reviewNote?: string
    }) {
      const returnRequest = await returnRequests.findById(params.returnRequestId)
      if (!returnRequest) throw new NotFoundError('ReturnRequest', params.returnRequestId)

      const newStatus = params.decision === 'approved' ? 'approved' : 'rejected'

      const updated = await returnRequests.review(params.returnRequestId, {
        status: newStatus,
        reviewedBy: params.adminActorId,
        ...(params.reviewNote !== undefined && { reviewNote: params.reviewNote }),
      })

      // Update order status accordingly
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
     * Mark item received and trigger refund — admin action.
     *
     * Akış:
     *   1. Siparişi return_received → refund_pending'e taşı
     *   2. Iyzico üzerinden iade başlat (payment.providerRef → paymentTransactionId)
     *   3. Başarılıysa returnRequest'i refunded olarak işaretle
     *   4. Audit log yaz
     *
     * Iyzico iade başarısız olursa ConflictError fırlatılır — payout blokajı devam eder.
     */
    async markItemReceived(params: {
      returnRequestId: string
      adminActorId: string
      refundAmount: import('@prisma/client/runtime/client').Decimal
      /** Admin arayüzünden gelen IP — Iyzico refund için zorunlu */
      adminIp?: string
    }) {
      const returnRequest = await returnRequests.findById(params.returnRequestId)
      if (!returnRequest) throw new NotFoundError('ReturnRequest', params.returnRequestId)

      await orders.updateStatus(returnRequest.orderId, 'return_received')
      await orders.updateStatus(returnRequest.orderId, 'refund_pending')

      // Ödeme kaydını bul — Iyzico providerPaymentId (paymentTransactionId olarak kullanılır)
      const payment = await prisma.payment.findFirst({
        where: { orderId: returnRequest.orderId },
      })

      if (payment?.method === 'card' && payment.providerPaymentId) {
        // Iyzico üzerinden iade başlat
        const refundResult = await iyzicoRefund({
          paymentTransactionId: payment.providerPaymentId,
          price: params.refundAmount.toFixed(2),
          conversationId: `refund-${returnRequest.id}`,
          ip: params.adminIp ?? '127.0.0.1',
        })

        if (!refundResult.success) {
          throw new ConflictError(
            `Iyzico iade başarısız: ${refundResult.errorMessage ?? refundResult.errorCode ?? 'Bilinmeyen hata'}`,
          )
        }

        // İade event kaydı
        await prisma.paymentEvent.create({
          data: {
            paymentId: payment.id,
            eventType: 'refund_initiated',
            payload: {
              note: `Admin iadesi — ${params.refundAmount.toFixed(2)} TRY`,
              iyzicoRef: refundResult.paymentTransactionId ?? 'N/A',
            },
          },
        })
      }
      // EFT ödemelerinde Iyzico iade çağrısı yapılmaz — banka transferi manuel halledilir

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'return_approved',
        targetType: 'return_request',
        targetId: params.returnRequestId,
        previousData: { status: returnRequest.status },
        newData: { status: 'refund_pending', refundAmount: params.refundAmount },
        reason: `İade alındı, ${params.refundAmount.toFixed(2)} TRY iade başlatıldı`,
      })

      return returnRequests.markRefunded(params.returnRequestId, params.refundAmount)
    },

    /**
     * Müşteri, satıcı veya admin iade talebine mesaj ekler.
     */
    async addMessage(params: {
      returnRequestId: string
      authorId: string
      authorRole: UserRole
      body: string
    }) {
      const returnRequest = await returnRequests.findById(params.returnRequestId)
      if (!returnRequest) throw new NotFoundError('ReturnRequest', params.returnRequestId)

      if (returnRequest.status === 'rejected' || returnRequest.status === 'refund_completed') {
        throw new ConflictError('Kapalı iade talebine mesaj eklenemez')
      }

      assertNoContactSharing(params.body)

      return prisma.returnMessage.create({
        data: {
          returnRequestId: params.returnRequestId,
          authorId: params.authorId,
          authorRole: params.authorRole,
          body: params.body,
        },
      })
    },

    getRequest(id: string) {
      return returnRequests.findById(id)
    },

    listForAdmin(params: Parameters<typeof returnRequests.listForAdmin>[0]) {
      return returnRequests.listForAdmin(params)
    },
  }
}

export type ReturnService = ReturnType<typeof createReturnService>
