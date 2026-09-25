import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import {
  orderAmountSummary,
  recordWholeOrderCancellationNotifications,
  type OrderEmailSnapshot,
} from '../../../api/services/order-email-payload'

/**
 * `orderAmountSummary` only reads a handful of fields off the full
 * `OrderEmailSnapshot` Prisma payload; the cast keeps this test independent
 * of unrelated relations (customer, lines, ...).
 */
function buildOrder(overrides: {
  grossAmount?: number
  discountAmount?: number
  couponCode?: string | null
  eftDiscountAmount?: number
  eftDiscountRateSnapshot?: number | null
  shippingAmount?: number
  paymentEftDiscounts?: number[]
}): OrderEmailSnapshot {
  return {
    grossAmount: new Decimal(overrides.grossAmount ?? 0),
    discountAmount: new Decimal(overrides.discountAmount ?? 0),
    couponCode: overrides.couponCode ?? null,
    eftDiscountAmount: new Decimal(overrides.eftDiscountAmount ?? 0),
    eftDiscountRateSnapshot:
      overrides.eftDiscountRateSnapshot != null ? new Decimal(overrides.eftDiscountRateSnapshot) : null,
    shippingAmount: new Decimal(overrides.shippingAmount ?? 0),
    payments: (overrides.paymentEftDiscounts ?? []).map((amount) => ({
      eftDiscountAmount: new Decimal(amount),
    })),
  } as unknown as OrderEmailSnapshot
}

describe('orderAmountSummary', () => {
  it('splits checkout coupon discount from the admin EFT-approval manual discount', () => {
    // Order.discountAmount (300) = checkout coupon (200) + admin manual discount (100,
    // persisted on the payment via Payment.eftDiscountAmount).
    const order = buildOrder({
      grossAmount: 6000,
      discountAmount: 300,
      couponCode: 'HOSGELDIN',
      eftDiscountAmount: 180,
      eftDiscountRateSnapshot: 0.03,
      shippingAmount: 0,
      paymentEftDiscounts: [100],
    })

    const summary = orderAmountSummary(order)

    expect(summary.subtotal).toBe('6.000 TL')
    expect(summary.couponDiscount).toBe('200 TL')
    expect(summary.couponCode).toBe('HOSGELDIN')
    expect(summary.eftDiscount).toBe('180 TL')
    expect(summary.eftDiscountRate).toBe('%3')
    expect(summary.additionalDiscount).toBe('100 TL')
    expect(summary.shipping).toBe('Ücretsiz')
  })

  it('does not double count the manual discount as a coupon when no coupon was used', () => {
    // Regression: Order.discountAmount (100) is entirely the admin manual
    // discount; before the fix couponDiscount was set to the full
    // discountAmount, showing the same 100 TL twice.
    const order = buildOrder({
      grossAmount: 1000,
      discountAmount: 100,
      couponCode: null,
      paymentEftDiscounts: [100],
    })

    const summary = orderAmountSummary(order)

    expect(summary.couponDiscount).toBeUndefined()
    expect(summary.couponCode).toBeUndefined()
    expect(summary.additionalDiscount).toBe('100 TL')
  })

  it('sums the manual discount across every payment on the order', () => {
    const order = buildOrder({
      grossAmount: 1000,
      discountAmount: 150,
      paymentEftDiscounts: [50, 50],
    })

    const summary = orderAmountSummary(order)

    expect(summary.additionalDiscount).toBe('100 TL')
    expect(summary.couponDiscount).toBe('50 TL')
  })

  it('omits the coupon and manual discount rows when neither applies', () => {
    const order = buildOrder({ grossAmount: 500, shippingAmount: 30 })

    const summary = orderAmountSummary(order)

    expect(summary.couponDiscount).toBeUndefined()
    expect(summary.additionalDiscount).toBeUndefined()
    expect(summary.eftDiscount).toBeUndefined()
    expect(summary.shipping).toBe('30 TL')
  })
})

function buildCancellationOrder() {
  return {
    id: 'order-1',
    publicNumber: 26050042,
    customerId: 'customer-1',
    totalAmount: new Decimal('4850.00'),
    customer: { id: 'customer-1', email: 'customer@example.com', name: 'Ayşe' },
    address: { fullName: 'Ayşe Yılmaz' },
    payments: [{ method: 'card', status: 'confirmed', confirmedAt: new Date(), eftDiscountAmount: new Decimal(0) }],
    lines: [
      {
        id: 'line-a',
        sellerId: 'seller-1',
        productName: 'Gea Berjer',
        variantName: 'Doğal keten',
        quantity: 1,
        cancelledQuantity: 0,
        unitPrice: new Decimal('4850.00'),
        totalPrice: new Decimal('4850.00'),
        product: { images: [] },
        seller: {
          id: 'seller-1',
          displayName: 'Atelier Noa',
          user: { id: 'seller-user-1', email: 'seller@example.com' },
        },
      },
    ],
  }
}

function buildTx() {
  return {
    order: { findUnique: vi.fn().mockResolvedValue(buildCancellationOrder()) },
    notificationOutbox: { upsert: vi.fn().mockResolvedValue({}) },
  }
}

describe('recordWholeOrderCancellationNotifications', () => {
  it('tells the customer the refund amount but never exposes it to the seller', async () => {
    const tx = buildTx()

    await recordWholeOrderCancellationNotifications(tx as never, 'order-1', {
      actorRole: 'admin',
      eventSuffix: 'admin',
    })

    const calls = tx.notificationOutbox.upsert.mock.calls.map(
      (call) => (call[0] as { create: { userId: string; payload: Record<string, unknown> } }).create,
    )
    const customerCreate = calls.find((call) => call.userId === 'customer-1')!
    const sellerCreate = calls.find((call) => call.userId === 'seller-user-1')!

    expect((customerCreate.payload as { data?: Record<string, unknown> }).data).toMatchObject({
      refundAmount: '4.850 TL',
    })
    // Seller-bound data must never carry the customer's paid/refund amount.
    expect((sellerCreate.payload as { data?: Record<string, unknown> }).data).not.toHaveProperty(
      'refundAmount',
    )
  })
})
