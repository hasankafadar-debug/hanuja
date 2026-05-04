/**
 * Product Review route handlers — thin: validate → auth → service → respond.
 * Business logic lives in api/services/product-review.service.ts.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { ProductReviewStatus } from '@prisma/client'
import { ok, created, handleError } from '../lib/response'
import { createProductReviewService } from '../services/product-review.service'
import { createPrismaForRoute } from '../lib/prisma'

const submitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(140).optional(),
  body: z.string().trim().min(10).max(4000),
  orderId: z.string().min(1).optional(),
})

const moderateSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  moderationNote: z.string().trim().max(2000).optional(),
})

const VALID_STATUS: ReadonlySet<ProductReviewStatus> = new Set([
  'pending_moderation',
  'approved',
  'rejected',
])

function getReviewService() {
  const prisma = createPrismaForRoute()
  return createProductReviewService({ prisma })
}

// GET /api/products/:id/reviews?skip=0&take=20 — public approved listing
export async function listProductReviews(req: NextRequest, productId: string) {
  try {
    const url = new URL(req.url)
    const skip = Math.max(0, Number(url.searchParams.get('skip') ?? '0'))
    const take = Math.min(50, Math.max(1, Number(url.searchParams.get('take') ?? '20')))
    const svc = getReviewService()
    const result = await svc.listForProduct({ productId, skip, take })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/products/:id/reviews — customer submits a review
export async function submitProductReview(
  req: NextRequest,
  productId: string,
  customerId: string,
) {
  try {
    const body = await req.json()
    const parsed = submitSchema.parse(body)
    const svc = getReviewService()
    const review = await svc.submitReview({
      productId,
      customerId,
      rating: parsed.rating,
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      body: parsed.body,
      ...(parsed.orderId !== undefined ? { orderId: parsed.orderId } : {}),
    })
    return created(review)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/products/:id/reviews/eligibility — has the user purchased + can write?
export async function checkReviewEligibility(productId: string, customerId: string) {
  try {
    const svc = getReviewService()
    const eligibility = await svc.checkEligibility({ productId, customerId })
    return ok(eligibility)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/reviews?status=pending_moderation&skip=0&take=30
export async function listReviewsForAdmin(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const statusParam = url.searchParams.get('status') ?? undefined
    const status =
      statusParam && VALID_STATUS.has(statusParam as ProductReviewStatus)
        ? (statusParam as ProductReviewStatus)
        : undefined
    const skip = Math.max(0, Number(url.searchParams.get('skip') ?? '0'))
    const take = Math.min(100, Math.max(1, Number(url.searchParams.get('take') ?? '30')))
    const svc = getReviewService()
    const result = await svc.listForAdmin({
      ...(status !== undefined ? { status } : {}),
      skip,
      take,
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/reviews/:id/moderate — approve | reject
export async function moderateReview(
  req: NextRequest,
  reviewId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const parsed = moderateSchema.parse(body)
    const svc = getReviewService()
    const updated = await svc.moderateReview({
      reviewId,
      adminActorId,
      decision: parsed.decision,
      ...(parsed.moderationNote !== undefined ? { moderationNote: parsed.moderationNote } : {}),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}
