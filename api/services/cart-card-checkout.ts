import type { PrismaClient } from '@prisma/client'
import { matchesCheckoutSource } from './checkout-source-fingerprint'

export type CartCardCheckout = {
  orderId: string
  state: 'pending' | 'failed' | 'checking' | 'expired'
  checkoutUrl: string | null
}

/** Database reads only: cart refreshes must never initialize or reconcile a payment. */
export async function getCartCardCheckout(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<CartCardCheckout | null> {
  const order = await prisma.order.findFirst({
    where: {
      customerId: userId,
      paymentConfirmedAt: null,
      payments: {
        some: { method: 'card' },
        none: { confirmedAt: { not: null } },
      },
      cardPaymentAttempts: { some: { flow: 'checkout_form' } },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      customerId: true,
      addressId: true,
      billingAddressId: true,
      totalAmount: true,
      status: true,
      cardPaymentExpiresAt: true,
      cardPaymentAttempts: {
        orderBy: { createdAt: 'desc' },
        select: {
          flow: true,
          sourceHash: true,
          legalContext: true,
          status: true,
          supersededAt: true,
          checkoutFormExpiresAt: true,
        },
      },
    },
  })
  if (!order || !(await matchesCheckoutSource(prisma, order))) return null
  const attempts = order.cardPaymentAttempts
  const attempt = attempts.find((candidate) => !candidate.supersededAt) ?? attempts[0]
  if (!attempt) return null
  const checking = attempts.some((candidate) =>
    ['authorizing', 'outcome_unknown', 'fraud_review'].includes(candidate.status),
  )
  if (checking) return { orderId: order.id, state: 'checking', checkoutUrl: null }
  const active = attempts.some(
    (candidate) =>
      !candidate.supersededAt &&
      candidate.status === 'checkout_form_pending' &&
      candidate.checkoutFormExpiresAt &&
      candidate.checkoutFormExpiresAt > now,
  )
  const expired =
    order.status !== 'payment_pending' ||
    !order.cardPaymentExpiresAt ||
    order.cardPaymentExpiresAt <= now ||
    (!active && attempts.length >= 5) ||
    (attempt.status === 'checkout_form_pending' &&
      (!attempt.checkoutFormExpiresAt || attempt.checkoutFormExpiresAt <= now)) ||
    attempt.supersededAt !== null ||
    ['expired', 'voided', 'refunded', 'refunded_by_provider'].includes(attempt.status)
  return {
    orderId: order.id,
    state: expired ? 'expired' : attempt.status === 'failed' ? 'failed' : 'pending',
    // The checkout page safely closes expired sessions before starting afresh.
    checkoutUrl: '/odeme?siparis=' + encodeURIComponent(order.id),
  }
}
