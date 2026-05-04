/**
 * Product Review Repository — persistence access only.
 * Eligibility, moderation rules, aggregate recompute live in the service layer.
 */
import type { Prisma, PrismaClient, ProductReviewStatus } from '@prisma/client'

export function createProductReviewRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.productReview.findUnique({
        where: { id },
        include: {
          product: { select: { id: true, name: true, slug: true, sellerId: true } },
          customer: { select: { id: true, name: true, email: true } },
        },
      })
    },

    findByOrderAndProduct(orderId: string, productId: string) {
      return prisma.productReview.findUnique({
        where: { orderId_productId: { orderId, productId } },
      })
    },

    create(data: {
      productId: string
      customerId: string
      orderId: string
      rating: number
      title?: string | null
      body: string
    }) {
      return prisma.productReview.create({
        data: {
          productId: data.productId,
          customerId: data.customerId,
          orderId: data.orderId,
          rating: data.rating,
          ...(data.title !== undefined && data.title !== null ? { title: data.title } : {}),
          body: data.body,
        },
      })
    },

    /** Public listing — only approved reviews, ordered newest first. */
    listApprovedForProduct(params: {
      productId: string
      skip?: number
      take?: number
    }) {
      return prisma.productReview.findMany({
        where: { productId: params.productId, status: 'approved' },
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    countApprovedForProduct(productId: string) {
      return prisma.productReview.count({
        where: { productId, status: 'approved' },
      })
    },

    /** Admin moderation queue — filterable by status. */
    async listForAdmin(params: {
      status?: ProductReviewStatus
      skip?: number
      take?: number
    }) {
      const where: Prisma.ProductReviewWhereInput = {
        ...(params.status !== undefined ? { status: params.status } : {}),
      }
      const [rows, total] = await Promise.all([
        prisma.productReview.findMany({
          where,
          include: {
            product: { select: { id: true, name: true, slug: true } },
            customer: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          ...(params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 30,
        }),
        prisma.productReview.count({ where }),
      ])
      return { rows, total }
    },

    /**
     * Update moderation status — admin only.
     * Aggregate recompute is service-layer responsibility.
     */
    moderate(
      id: string,
      params: {
        status: ProductReviewStatus
        moderatedBy: string
        moderationNote?: string
      },
    ) {
      return prisma.productReview.update({
        where: { id },
        data: {
          status: params.status,
          moderatedBy: params.moderatedBy,
          moderatedAt: new Date(),
          ...(params.moderationNote !== undefined ? { moderationNote: params.moderationNote } : {}),
        },
      })
    },

    /**
     * Recompute and persist product aggregate (avgRating + reviewCount).
     * Only counts approved reviews — pending and rejected are excluded.
     */
    async recomputeProductAggregate(productId: string, tx?: PrismaClient) {
      const client = tx ?? prisma
      const result = await client.productReview.aggregate({
        where: { productId, status: 'approved' },
        _avg: { rating: true },
        _count: { _all: true },
      })

      const avgRaw = result._avg.rating
      const count = result._count._all
      const avgRating = avgRaw === null ? null : Number(avgRaw.toFixed(2))

      return client.product.update({
        where: { id: productId },
        data: {
          avgRating: avgRating ?? null,
          reviewCount: count,
        },
        select: { id: true, avgRating: true, reviewCount: true },
      })
    },

    /**
     * Find an order line that matches (orderId, productId, customerId).
     * Used by service layer to validate the customer actually purchased the product.
     */
    findEligibleOrderLine(params: {
      orderId: string
      productId: string
      customerId: string
    }) {
      return prisma.orderLine.findFirst({
        where: {
          orderId: params.orderId,
          productId: params.productId,
          order: { customerId: params.customerId },
        },
        select: {
          id: true,
          order: {
            select: {
              id: true,
              status: true,
              deliveryConfirmedAt: true,
              customerId: true,
            },
          },
        },
      })
    },
  }
}

export type ProductReviewRepository = ReturnType<typeof createProductReviewRepository>
