/**
 * Product Review Service — review submission + admin moderation.
 *
 * Eligibility (06-content-guidelines + 08-order-lifecycle):
 *  - The customer must own the order
 *  - The order must contain the product
 *  - The order must be in delivery_confirmed (payout-eligible state)
 *  - One review per (order, product) pair
 *
 * Moderation (06-content-guidelines):
 *  - All submissions land in `pending_moderation`
 *  - Only `approved` reviews are visible publicly and feed the aggregate
 *  - Admin actions are audit-logged and reviewer is notified
 */
import type { PrismaClient, ProductReviewStatus } from '@prisma/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { createProductReviewRepository } from '../repositories/product-review.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { createNotificationService } from './notification.service'
import { assertNoContactSharing } from './contact-sharing-guard.service'

interface ProductReviewServiceDeps {
  prisma: PrismaClient
}

const REVIEW_BODY_MIN = 10
const REVIEW_BODY_MAX = 4000
const REVIEW_TITLE_MAX = 140

export function createProductReviewService({ prisma }: ProductReviewServiceDeps) {
  const reviews = createProductReviewRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)
  const notifications = createNotificationService({ prisma })

  return {
    /**
     * Returns whether a customer can submit a review for a given product on a given order.
     * Used by UI to decide whether to render the form vs. an explanation message.
     */
    async checkEligibility(params: {
      productId: string
      customerId: string
      orderId?: string
    }): Promise<
      | { eligible: true; orderId: string }
      | { eligible: false; reason: 'no_purchase' | 'not_delivery_confirmed' | 'already_reviewed' }
    > {
      // If a specific order was provided, validate it.
      if (params.orderId) {
        const line = await reviews.findEligibleOrderLine({
          orderId: params.orderId,
          productId: params.productId,
          customerId: params.customerId,
        })
        if (!line) return { eligible: false, reason: 'no_purchase' }
        if (!line.order.deliveryConfirmedAt) {
          return { eligible: false, reason: 'not_delivery_confirmed' }
        }
        const existing = await reviews.findByOrderAndProduct(params.orderId, params.productId)
        if (existing) return { eligible: false, reason: 'already_reviewed' }
        return { eligible: true, orderId: params.orderId }
      }

      // Otherwise pick any delivery_confirmed order this customer has containing the product.
      const candidate = await prisma.orderLine.findFirst({
        where: {
          productId: params.productId,
          order: {
            customerId: params.customerId,
            deliveryConfirmedAt: { not: null },
          },
        },
        select: { orderId: true },
        orderBy: { createdAt: 'desc' },
      })
      if (!candidate) return { eligible: false, reason: 'no_purchase' }

      const existing = await reviews.findByOrderAndProduct(candidate.orderId, params.productId)
      if (existing) return { eligible: false, reason: 'already_reviewed' }
      return { eligible: true, orderId: candidate.orderId }
    },

    /**
     * Customer submits a review. Lands in `pending_moderation`.
     * Aggregate is NOT updated until an admin approves.
     */
    async submitReview(params: {
      productId: string
      customerId: string
      rating: number
      title?: string
      body: string
      /** Optional explicit order. If omitted, the latest delivery_confirmed order is used. */
      orderId?: string
    }) {
      if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) {
        throw new ValidationError('Puan 1 ile 5 arasında olmalı')
      }
      const body = params.body.trim()
      if (body.length < REVIEW_BODY_MIN) {
        throw new ValidationError(`Yorum metni en az ${REVIEW_BODY_MIN} karakter olmalı`)
      }
      if (body.length > REVIEW_BODY_MAX) {
        throw new ValidationError(`Yorum metni en fazla ${REVIEW_BODY_MAX} karakter olabilir`)
      }
      assertNoContactSharing(body)

      const title = params.title?.trim()
      if (title && title.length > REVIEW_TITLE_MAX) {
        throw new ValidationError(`Başlık en fazla ${REVIEW_TITLE_MAX} karakter olabilir`)
      }
      if (title) assertNoContactSharing(title)

      const eligibility = await this.checkEligibility({
        productId: params.productId,
        customerId: params.customerId,
        ...(params.orderId !== undefined ? { orderId: params.orderId } : {}),
      })
      if (!eligibility.eligible) {
        if (eligibility.reason === 'no_purchase') {
          throw new ForbiddenError('Bu ürünü satın aldığınıza dair bir kayıt bulunamadı')
        }
        if (eligibility.reason === 'not_delivery_confirmed') {
          throw new ConflictError('Teslim onaylanmadan değerlendirme yazılamaz')
        }
        throw new ConflictError('Bu sipariş için ürün değerlendirmesi zaten mevcut')
      }

      const review = await reviews.create({
        productId: params.productId,
        customerId: params.customerId,
        orderId: eligibility.orderId,
        rating: params.rating,
        ...(title ? { title } : {}),
        body,
      })

      return review
    },

    /**
     * Public listing — only approved reviews.
     */
    async listForProduct(params: { productId: string; skip?: number; take?: number }) {
      const [items, total] = await Promise.all([
        reviews.listApprovedForProduct(params),
        reviews.countApprovedForProduct(params.productId),
      ])
      return { items, total }
    },

    /** Admin moderation queue. */
    listForAdmin(params: {
      status?: ProductReviewStatus
      skip?: number
      take?: number
    }) {
      return reviews.listForAdmin(params)
    },

    getReview(id: string) {
      return reviews.findById(id)
    },

    /**
     * Admin approves or rejects a review.
     * On approve: aggregate is recomputed, customer is notified.
     * On reject: aggregate is recomputed (in case it was previously approved), customer is notified with reason.
     * Audit-logged either way.
     */
    async moderateReview(params: {
      reviewId: string
      adminActorId: string
      decision: 'approved' | 'rejected'
      moderationNote?: string
    }) {
      const existing = await reviews.findById(params.reviewId)
      if (!existing) throw new NotFoundError('ProductReview', params.reviewId)

      const newStatus: ProductReviewStatus = params.decision === 'approved' ? 'approved' : 'rejected'

      const updated = await reviews.moderate(params.reviewId, {
        status: newStatus,
        moderatedBy: params.adminActorId,
        ...(params.moderationNote !== undefined ? { moderationNote: params.moderationNote } : {}),
      })

      // Recompute aggregate when approval state may change visible review set
      if (newStatus === 'approved' || existing.status === 'approved') {
        await reviews.recomputeProductAggregate(existing.productId)
      }

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType:
          params.decision === 'approved' ? 'product_review_approved' : 'product_review_rejected',
        targetType: 'product_review',
        targetId: params.reviewId,
        previousData: { status: existing.status },
        newData: { status: newStatus },
        ...(params.moderationNote !== undefined ? { reason: params.moderationNote } : {}),
      })

      // Notify the customer who wrote the review
      if (params.decision === 'approved') {
        await notifications
          .send({
            userId: existing.customerId,
            type: 'product_review_approved',
            title: 'Değerlendirmen yayınlandı',
            body: `"${existing.product.name}" için yazdığın değerlendirme yayında.`,
            data: { productSlug: existing.product.slug, reviewId: existing.id },
          })
          .catch(() => undefined)
      } else {
        await notifications
          .send({
            userId: existing.customerId,
            type: 'product_review_rejected',
            title: 'Değerlendirmen yayınlanamadı',
            body:
              params.moderationNote && params.moderationNote.length > 0
                ? `"${existing.product.name}" için yazdığın değerlendirme yayınlanamadı: ${params.moderationNote}`
                : `"${existing.product.name}" için yazdığın değerlendirme moderasyon kurallarına uymadığı için yayınlanmadı.`,
            data: { productSlug: existing.product.slug, reviewId: existing.id },
          })
          .catch(() => undefined)
      }

      return updated
    },
  }
}

export type ProductReviewService = ReturnType<typeof createProductReviewService>
