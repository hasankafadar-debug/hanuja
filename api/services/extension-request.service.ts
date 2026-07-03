/**
 * Fulfillment Extension Request Service
 *
 * Three-way flow:
 *   1. Seller submits a request close to the 20-business-day deadline.
 *   2. Admin reviews and either approves, rejects, asks the seller for more
 *      detail, or escalates to the customer for explicit consent.
 *   3. Customer responds (with IP/UA/session snapshot as legal evidence).
 *   4. On approval, the daily late-shipment accrual pauses for the granted
 *      window and the breach deadline is effectively pushed back.
 */
import type { ExtensionRequestStatus, PrismaClient } from '@prisma/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { createPenaltyService } from './penalty.service'

interface ExtensionRequestServiceDeps {
  prisma: PrismaClient
}

export function createExtensionRequestService({ prisma }: ExtensionRequestServiceDeps) {
  const penaltyService = createPenaltyService({ prisma })

  return {
    /** Seller submits a new extension request. */
    async createBySeller(params: {
      orderId: string
      sellerId: string
      requestedDays: number
      sellerReason: string
    }) {
      if (params.requestedDays <= 0 || params.requestedDays > 30) {
        throw new ValidationError('Talep edilen gün sayısı 1-30 aralığında olmalıdır.')
      }

      const reason = params.sellerReason.trim()
      if (!reason) {
        throw new ValidationError('Ek süre talep sebebi gerekli.')
      }

      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        select: { id: true, customerId: true, status: true },
      })
      if (!order) throw new NotFoundError('Order', params.orderId)

      // Seller can only request extension while the order is still in active
      // fulfillment statuses.
      const ALLOWED_STATUSES = [
        'seller_queue_ready',
        'seller_reviewing',
        'seller_accepted',
        'preparing',
        'awaiting_shipment',
      ] as const
      if (!ALLOWED_STATUSES.includes(order.status as (typeof ALLOWED_STATUSES)[number])) {
        throw new ConflictError(`Bu sipariş durumu için ek süre talebi açılamaz: ${order.status}`)
      }

      // Reject if there's already an open request (anything not in a terminal state)
      const existingOpen = await prisma.fulfillmentExtensionRequest.findFirst({
        where: {
          orderId: params.orderId,
          sellerId: params.sellerId,
          status: {
            in: [
              'pending_admin_review',
              'awaiting_customer_decision',
              'awaiting_seller_followup',
            ] as ExtensionRequestStatus[],
          },
        },
        select: { id: true, status: true },
      })
      if (existingOpen) {
        throw new ConflictError('Bu sipariş için zaten açık bir ek süre talebi var.')
      }

      return prisma.fulfillmentExtensionRequest.create({
        data: {
          orderId: params.orderId,
          sellerId: params.sellerId,
          customerId: order.customerId,
          requestedDays: params.requestedDays,
          sellerReason: reason,
          status: 'pending_admin_review',
        },
      })
    },

    /** Admin approves the request directly. */
    async approveByAdmin(params: {
      requestId: string
      adminActorId: string
      approvedDays: number
      adminNote?: string
    }) {
      const request = await prisma.fulfillmentExtensionRequest.findUnique({
        where: { id: params.requestId },
      })
      if (!request) throw new NotFoundError('FulfillmentExtensionRequest', params.requestId)
      if (request.status === 'approved') return request
      if (request.status === 'rejected_by_admin' || request.status === 'rejected_by_customer') {
        throw new ConflictError('Reddedilmiş talep onaylanamaz.')
      }

      if (params.approvedDays <= 0 || params.approvedDays > 30) {
        throw new ValidationError('Onaylanan gün sayısı 1-30 aralığında olmalıdır.')
      }

      const updated = await prisma.fulfillmentExtensionRequest.update({
        where: { id: params.requestId },
        data: {
          status: 'approved',
          approvedDays: params.approvedDays,
          approvedAt: new Date(),
          approvedBy: params.adminActorId,
          adminReviewedAt: new Date(),
          adminReviewedBy: params.adminActorId,
          ...(params.adminNote !== undefined ? { adminNote: params.adminNote } : {}),
        },
      })

      // Roll back any late-shipment accrual entries written before the
      // extension was granted so Penalty.penaltyAmount and the ledger stay
      // consistent with the new effective deadline.
      await penaltyService.reverseAccrualForExtension({
        orderId: updated.orderId,
        extensionRequestId: updated.id,
        adminActorId: params.adminActorId,
      })

      return updated
    },

    /** Admin rejects the request. */
    async rejectByAdmin(params: {
      requestId: string
      adminActorId: string
      adminNote: string
    }) {
      const request = await prisma.fulfillmentExtensionRequest.findUnique({
        where: { id: params.requestId },
      })
      if (!request) throw new NotFoundError('FulfillmentExtensionRequest', params.requestId)
      if (request.status === 'rejected_by_admin') return request
      if (request.status === 'approved') {
        throw new ConflictError('Onaylı talep reddedilemez.')
      }

      const note = params.adminNote.trim()
      if (!note) throw new ValidationError('Red gerekçesi gerekli.')

      return prisma.fulfillmentExtensionRequest.update({
        where: { id: params.requestId },
        data: {
          status: 'rejected_by_admin',
          adminNote: note,
          adminReviewedAt: new Date(),
          adminReviewedBy: params.adminActorId,
        },
      })
    },

    /** Admin escalates the request to the customer with a question. */
    async escalateToCustomer(params: {
      requestId: string
      adminActorId: string
      questionForCustomer: string
    }) {
      const question = params.questionForCustomer.trim()
      if (!question) throw new ValidationError('Müşteriye gönderilecek soru gerekli.')

      const request = await prisma.fulfillmentExtensionRequest.findUnique({
        where: { id: params.requestId },
      })
      if (!request) throw new NotFoundError('FulfillmentExtensionRequest', params.requestId)
      if (request.status === 'approved' || request.status === 'rejected_by_admin') {
        throw new ConflictError('Sonuçlanmış talep müşteriye iletilemez.')
      }

      return prisma.fulfillmentExtensionRequest.update({
        where: { id: params.requestId },
        data: {
          status: 'awaiting_customer_decision',
          customerQuestionFromAdmin: question,
          adminReviewedAt: new Date(),
          adminReviewedBy: params.adminActorId,
        },
      })
    },

    /** Admin asks the seller to provide more detail before deciding. */
    async sendBackToSeller(params: {
      requestId: string
      adminActorId: string
      adminNote: string
    }) {
      const note = params.adminNote.trim()
      if (!note) throw new ValidationError('Satıcıdan istenecek bilgi gerekli.')

      const request = await prisma.fulfillmentExtensionRequest.findUnique({
        where: { id: params.requestId },
      })
      if (!request) throw new NotFoundError('FulfillmentExtensionRequest', params.requestId)
      if (request.status === 'approved' || request.status === 'rejected_by_admin') {
        throw new ConflictError('Sonuçlanmış talep satıcıya gönderilemez.')
      }

      return prisma.fulfillmentExtensionRequest.update({
        where: { id: params.requestId },
        data: {
          status: 'awaiting_seller_followup',
          adminNote: note,
          adminReviewedAt: new Date(),
          adminReviewedBy: params.adminActorId,
        },
      })
    },

    /** Customer responds with approval (legal evidence captured). */
    async respondByCustomer(params: {
      requestId: string
      customerId: string
      decision: 'approve' | 'reject'
      responseNote?: string
      ipAddress?: string | null
      userAgent?: string | null
      sessionId?: string | null
    }) {
      const request = await prisma.fulfillmentExtensionRequest.findUnique({
        where: { id: params.requestId },
      })
      if (!request) throw new NotFoundError('FulfillmentExtensionRequest', params.requestId)
      if (request.customerId !== params.customerId) {
        throw new ValidationError('Bu talep size ait değil.')
      }
      if (request.status !== 'awaiting_customer_decision') {
        throw new ConflictError(`Mevcut durumda müşteri yanıtı kabul edilemez: ${request.status}`)
      }

      const nextStatus: ExtensionRequestStatus =
        params.decision === 'approve' ? 'approved' : 'rejected_by_customer'
      const approvedDays = params.decision === 'approve' ? request.requestedDays : null

      const updated = await prisma.fulfillmentExtensionRequest.update({
        where: { id: params.requestId },
        data: {
          status: nextStatus,
          customerRespondedAt: new Date(),
          ...(params.responseNote !== undefined ? { customerResponseNote: params.responseNote } : {}),
          ...(params.ipAddress !== undefined ? { customerResponseIp: params.ipAddress } : {}),
          ...(params.userAgent !== undefined ? { customerResponseUserAgent: params.userAgent } : {}),
          ...(params.sessionId !== undefined ? { customerResponseSessionId: params.sessionId } : {}),
          ...(approvedDays !== null
            ? { approvedDays, approvedAt: new Date(), approvedBy: request.adminReviewedBy ?? 'customer' }
            : {}),
        },
      })

      // Customer-approved extensions also trigger accrual reversal — same as
      // the admin path. We attribute the actor to the admin who escalated the
      // request when present, otherwise the customer themselves.
      if (params.decision === 'approve') {
        await penaltyService.reverseAccrualForExtension({
          orderId: updated.orderId,
          extensionRequestId: updated.id,
          adminActorId: request.adminReviewedBy ?? params.customerId,
        })
      }

      return updated
    },

    /**
     * Returns the currently approved extension for an order, if any.
     * Used by the penalty accrual worker to skip days within the granted window.
     */
    async getActiveApproval(orderId: string) {
      return prisma.fulfillmentExtensionRequest.findFirst({
        where: {
          orderId,
          status: 'approved',
          approvedDays: { not: null },
        },
        select: {
          id: true,
          approvedDays: true,
          approvedAt: true,
        },
        orderBy: { approvedAt: 'desc' },
      })
    },
  }
}

export type ExtensionRequestService = ReturnType<typeof createExtensionRequestService>
