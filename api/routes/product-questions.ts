/**
 * Product question route handlers — thin HTTP wrappers around
 * createProductQuestionService. App route files run the guards in this order
 * before calling them: checkCsrf → checkRateLimit (IP) → session →
 * checkUserRateLimit (the authenticated user) → handler.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import type { RateLimitConfig } from '@hanuja/security'
import { ok, created, handleError } from '../lib/response'
import { readJsonBody } from '../lib/request-body'
import { createPrismaForRoute } from '../lib/prisma'
import { createProductQuestionService } from '../services/product-question.service'

/** Coarse per-IP guard before the session lookup. */
export const PRODUCT_QUESTION_IP_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 }
/** New conversations per customer. */
export const PRODUCT_QUESTION_ASK_RATE_LIMIT: RateLimitConfig = { limit: 5, windowMs: 60 * 60 * 1000 }
/** Replies per user (customer or seller). */
export const PRODUCT_QUESTION_REPLY_RATE_LIMIT: RateLimitConfig = { limit: 20, windowMs: 10 * 60 * 1000 }
/** Read receipts per user. */
export const PRODUCT_QUESTION_READ_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 }

function getSvc() {
  return createProductQuestionService({ prisma: createPrismaForRoute() })
}

// Coarse bound only; the stored-text rule (trim, 2–2000, contact guard) is in the service.
const bodySchema = z.string().max(4000)

const askSchema = z.object({
  productId: z.string().min(1).max(64),
  orderId: z.string().min(1).max(64).optional(),
  body: bodySchema,
})

const replySchema = z.object({ body: bodySchema })

const readSchema = z.object({ lastSeenMessageId: z.string().min(1).max(64) })

// POST /api/product-questions
export async function askProductQuestion(
  req: NextRequest,
  customer: { id: string; role: string },
) {
  try {
    const parsed = askSchema.parse(await readJsonBody(req))
    const result = await getSvc().askQuestion({
      customerId: customer.id,
      customerRole: customer.role as 'customer' | 'seller' | 'admin',
      productId: parsed.productId,
      orderId: parsed.orderId ?? null,
      body: parsed.body,
    })
    return created({ threadId: result.threadId, created: result.created })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/product-questions/:id/messages
export async function replyProductQuestionAsCustomer(
  req: NextRequest,
  threadId: string,
  customerId: string,
) {
  try {
    const parsed = replySchema.parse(await readJsonBody(req))
    const result = await getSvc().replyAsCustomer({ threadId, customerId, body: parsed.body })
    return created({ messageId: result.messageId })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/seller/product-questions/:id/messages
export async function replyProductQuestionAsSeller(
  req: NextRequest,
  threadId: string,
  seller: { sellerId: string; userId: string },
) {
  try {
    const parsed = replySchema.parse(await readJsonBody(req))
    const result = await getSvc().replyAsSeller({
      threadId,
      sellerId: seller.sellerId,
      authorUserId: seller.userId,
      body: parsed.body,
    })
    return created({ messageId: result.messageId })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/product-questions/:id/read and /api/seller/product-questions/:id/read
export async function markProductQuestionRead(
  req: NextRequest,
  threadId: string,
  viewer: { role: 'customer'; customerId: string } | { role: 'seller'; sellerId: string },
) {
  try {
    const parsed = readSchema.parse(await readJsonBody(req))
    const result = await getSvc().markRead(threadId, viewer, parsed.lastSeenMessageId)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
