/**
 * Product questions: a customer asks Hanuja about a product; Hanuja and the
 * designer (seller) work on the answer. Pure rules only — persistence,
 * notification and audit live in `api/services/product-question.service.ts`.
 */
import type { ProductQuestionStatus, ProductStatus, SellerStatus } from '@prisma/client'
import { canSeeMessage } from './communication-audience'

export const PRODUCT_QUESTION_MESSAGE_MIN = 2
export const PRODUCT_QUESTION_MESSAGE_MAX = 2000

export type ProductQuestionAuthor = 'customer' | 'seller'

/**
 * Who sees which product question message. The customer sees only their own
 * channel (`canSeeMessage`). The designer also sees the customer's own messages
 * — the question text, without the customer's identity — but never Hanuja's
 * replies to the customer. Return and dispute threads keep `canSeeMessage`.
 */
export function isProductQuestionMessageVisibleTo(
  viewer: 'customer' | 'seller',
  message: { authorRole: string; audience?: string | null },
): boolean {
  if (viewer === 'seller' && message.authorRole === 'customer') return true
  return canSeeMessage(viewer, message)
}

export type QuestionBodyCheck =
  | { ok: true; body: string }
  | { ok: false; reason: 'too_short' | 'too_long' }

/** Trims and bounds a message body. Contact-sharing is checked by the service on the result. */
export function checkQuestionBodyLength(raw: string): QuestionBodyCheck {
  const body = raw.trim()
  if (body.length < PRODUCT_QUESTION_MESSAGE_MIN) return { ok: false, reason: 'too_short' }
  if (body.length > PRODUCT_QUESTION_MESSAGE_MAX) return { ok: false, reason: 'too_long' }
  return { ok: true, body }
}

const PRESALE_KEY_SEGMENT = 'presale'

/** Unique conversation key; also unique when there is no order (pre-sale). */
export function buildThreadKey(customerId: string, productId: string, orderId: string | null): string {
  return `${customerId}:${productId}:${orderId ?? PRESALE_KEY_SEGMENT}`
}

/** Status after `author` writes: the other side is now expected to answer. */
export function statusAfterMessage(author: ProductQuestionAuthor): ProductQuestionStatus {
  return author === 'customer' ? 'waiting_for_seller' : 'waiting_for_customer'
}

/** Status a message by `author` turns over; only that transition notifies the other side. */
export function statusTurnedOverBy(author: ProductQuestionAuthor): ProductQuestionStatus {
  return author === 'customer' ? 'waiting_for_customer' : 'waiting_for_seller'
}

/** Sellers who may still run operations (answer existing conversations, see orders). */
export function isSellerOperational(status: SellerStatus): boolean {
  return status === 'active' || status === 'suspended'
}

export type PresaleAskability =
  | { ok: true }
  | { ok: false; reason: 'product_not_published' | 'seller_not_active' | 'seller_on_vacation' | 'own_product' }

/** Pre-sale question: only a product that is on sale right now. */
export function checkPresaleAskable(input: {
  productStatus: ProductStatus
  sellerStatus: SellerStatus
  vacationModeEnabled: boolean
  sellerUserId: string
  customerId: string
}): PresaleAskability {
  if (input.sellerUserId === input.customerId) return { ok: false, reason: 'own_product' }
  if (input.productStatus !== 'published') return { ok: false, reason: 'product_not_published' }
  if (input.sellerStatus !== 'active') return { ok: false, reason: 'seller_not_active' }
  if (input.vacationModeEnabled) return { ok: false, reason: 'seller_on_vacation' }
  return { ok: true }
}

export type OrderAskability =
  | { ok: true }
  | { ok: false; reason: 'order_not_found' | 'payment_not_confirmed' | 'product_not_in_order' | 'seller_not_operational' }

/**
 * Question about an ordered product. The product's current sale state is
 * deliberately ignored — a buyer can ask about an item that was unlisted later.
 * The order must be visible to the seller (payment confirmed).
 */
export function checkOrderAskable(input: {
  orderFound: boolean
  paymentConfirmed: boolean
  lineFound: boolean
  sellerStatus: SellerStatus | null
}): OrderAskability {
  if (!input.orderFound) return { ok: false, reason: 'order_not_found' }
  if (!input.paymentConfirmed) return { ok: false, reason: 'payment_not_confirmed' }
  if (!input.lineFound) return { ok: false, reason: 'product_not_in_order' }
  if (!input.sellerStatus || !isSellerOperational(input.sellerStatus)) {
    return { ok: false, reason: 'seller_not_operational' }
  }
  return { ok: true }
}

/**
 * Unread when the other side's last message is past the viewer's read boundary.
 * Both are per-thread message sequence numbers assigned under the thread row
 * lock, so the comparison does not depend on clocks or commit order.
 */
export function isThreadUnread(lastOtherMessageSeq: number, lastReadSeq: number): boolean {
  return lastOtherMessageSeq > lastReadSeq
}

/** A late internal answer can be dismissed only after Hanuja answered the customer. */
export function canCompleteProductQuestionReview(
  thread: { status: ProductQuestionStatus; lastSellerMessageSeq: number },
  lastCustomerSeq: number,
): boolean {
  return thread.status === 'waiting_for_seller' && lastCustomerSeq > 0 &&
    thread.lastSellerMessageSeq > lastCustomerSeq
}
