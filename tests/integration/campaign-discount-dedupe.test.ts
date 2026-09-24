// This suite isolates existing campaign behavior with a configured channel. Central fail-closed behavior has dedicated tests.
vi.mock('../../api/services/marketing-channel.service', () => ({
  getMarketingChannelStatus: async () => ({ canSend: true }),
}))
/**
 * Integration test — cart discount e-mail vs. the lowest-price e-mail (e-mail plan phase 6).
 *
 * Contract:
 *   - favoriting alone no longer earns a discount e-mail; the cart e-mail goes to cart holders;
 *   - a user who favorited AND has the product in the cart gets the lowest-price e-mail when this
 *     campaign produced an eligible price drop — the cart e-mail gives way, deterministically;
 *   - without an eligible drop (e.g. the first 15 days of history) the cart e-mail still goes;
 *   - reservations go through the real reservation module (shared limits, idempotency).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))
vi.mock('../../api/services/price-change-reconcile.service', () => ({
  processPriceChangeMarkers: vi.fn(async () => ({ explained: 0, reset: 0, ignored: 0, resetProducts: 0 })),
}))
vi.mock('../../api/services/price-drop-evaluation.service', () => ({
  materializeDuePredictions: vi.fn(async () => ({ materialized: 0, candidates: 0 })),
  evaluatePriceDropCandidates: vi.fn(async () => ({ products: 0, pending: 0, ineligible: 0, grouped: 0 })),
}))
const outbox = vi.hoisted(() => ({ rows: [] as Array<{ userId: string; type: string; eventKey?: string }> }))
vi.mock('../../api/services/notification-outbox.service', () => ({
  recordNotification: vi.fn(async (_tx: unknown, payload: { userId: string; type: string; eventKey?: string }) => {
    outbox.rows.push(payload)
  }),
  recordNotifications: vi.fn(),
}))

import { createCampaignDiscountService } from '../../api/services/campaign-discount.service'

const CONSENT_AT = new Date('2026-07-01T00:00:00.000Z')
const NOW = new Date('2026-07-17T12:00:00.000Z')

interface DispatchRow {
  id: string
  userId: string
  productId: string | null
  discountFingerprint: string
  source: string
  status: string
  eventKey: string | null
  sentAt: Date | null
  sendingAt: Date | null
  createdAt: Date
}

function matchesDispatch(row: DispatchRow, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      const options = condition as Array<Record<string, unknown>>
      if (!options.some((option) => matchesDispatch(row, option))) return false
      continue
    }
    const value = (row as unknown as Record<string, unknown>)[key]
    if (condition === null) {
      if (value !== null) return false
    } else if (typeof condition === 'object' && condition !== null) {
      const c = condition as { in?: unknown[]; gte?: Date; not?: unknown }
      if (c.in && !c.in.includes(value)) return false
      if (c.gte && !(value instanceof Date && value.getTime() >= c.gte.getTime())) return false
      if ('not' in c && value === c.not) return false
    } else if (value !== condition) {
      return false
    }
  }
  return true
}

function createPrisma(options: { dropEvent?: 'pending' | 'ineligible' | null } = {}) {
  const product = { id: 'product-1', sellerId: 'seller-1', name: 'Rattan Salıncak', slug: 'rattan-salincak' }
  const users = [
    { id: 'user-dual', email: 'nazli.dual@example.com', name: 'Nazlı Ünal' },
    { id: 'user-cart', email: 'kerem.cart@example.com', name: 'Kerem Bal' },
  ]
  const consents = [
    { userId: 'user-dual', emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-dual' },
    { userId: 'user-cart', emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-cart' },
  ]
  const favorites = [{ userId: 'user-dual', productId: 'product-1' }]
  const cartItems = [
    { productId: 'product-1', cart: { userId: 'user-dual' } },
    { productId: 'product-1', cart: { userId: 'user-cart' } },
  ]
  const events = options.dropEvent
    ? [{ productId: 'product-1', status: options.dropEvent, changeAt: new Date('2026-07-10T00:00:05.000Z') }]
    : []
  const dispatches: DispatchRow[] = []

  const prisma = {
    _dispatches: dispatches,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRaw: vi.fn(async () => 1),
    discountRule: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'rule-product'
          ? {
              id: 'rule-product',
              sellerId: 'seller-1',
              scope: 'PRODUCT' as const,
              categoryId: null,
              startsAt: null,
              createdAt: new Date('2026-07-10T00:00:00.000Z'),
              products: [{ productId: 'product-1' }],
              seller: { userId: 'seller-user-1' },
            }
          : null,
      ),
    },
    product: { findMany: vi.fn(async () => [product]) },
    favoriteProduct: {
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] }; productId: { in: string[] } } }) =>
        favorites.filter((row) => where.userId.in.includes(row.userId) && where.productId.in.includes(row.productId)),
      ),
    },
    priceDropEvent: {
      findMany: vi.fn(async ({ where }: { where: { status: { in: string[] }; changeAt: { gte: Date } } }) =>
        events
          .filter((event) => where.status.in.includes(event.status) && event.changeAt >= where.changeAt.gte)
          .map((event) => ({ productId: event.productId })),
      ),
    },
    cartItem: {
      findMany: vi.fn(async ({ where }: { where: { productId: { in: string[] } } }) =>
        cartItems.filter((item) => where.productId.in.includes(item.productId)),
      ),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        users.filter((user) => where.id.in.includes(user.id)),
      ),
    },
    marketingConsent: {
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
        consents.filter((consent) => where.userId.in.includes(consent.userId)),
      ),
    },
    campaignEmailDispatch: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const map: Record<string, unknown> = { ...where }
        if ('discountFingerprint' in map) {
          return dispatches.find((row) => matchesDispatch(row, map)) ?? null
        }
        return null
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        dispatches.filter((row) => matchesDispatch(row, where)).length,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        dispatches.filter((row) => matchesDispatch(row, where)),
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Omit<DispatchRow, 'id' | 'sentAt' | 'sendingAt' | 'createdAt'> }) => {
        const row: DispatchRow = {
          ...data,
          productId: data.productId ?? null,
          eventKey: data.eventKey ?? null,
          id: `dispatch-${dispatches.length + 1}`,
          sentAt: null,
          sendingAt: null,
          createdAt: NOW,
        }
        dispatches.push(row)
        return { id: row.id }
      }),
    },
  }
  return prisma
}

describe('campaign discount — cart e-mail vs. lowest-price e-mail', () => {
  beforeEach(() => {
    outbox.rows.length = 0
  })

  function serviceFor(prisma: ReturnType<typeof createPrisma>) {
    return createCampaignDiscountService({ prisma: prisma as unknown as PrismaClient })
  }

  const params = {
    discountRuleId: 'rule-product',
    discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
    sellerName: 'Atölye Kuzey',
    now: NOW,
  }

  it('without an eligible price drop, both cart holders get one cart e-mail each (favoriting changes nothing)', async () => {
    const prisma = createPrisma({ dropEvent: null })
    const result = await serviceFor(prisma).notifyDiscountAudience(params)

    expect(result).toEqual({ notified: 2, superseded: 0, skipped: 0 })
    expect(outbox.rows.map((row) => row.type)).toEqual(['product_discount_in_cart', 'product_discount_in_cart'])
    expect(prisma._dispatches.map((row) => [row.userId, row.source, row.status])).toEqual([
      ['user-dual', 'cart', 'reserved'],
      ['user-cart', 'cart', 'reserved'],
    ])
  })

  it('an eligible price drop of this campaign wins for the favoriter; the cart-only user still gets the cart e-mail', async () => {
    const prisma = createPrisma({ dropEvent: 'pending' })
    const result = await serviceFor(prisma).notifyDiscountAudience(params)

    expect(result).toEqual({ notified: 1, superseded: 1, skipped: 0 })
    expect(outbox.rows.map((row) => row.userId)).toEqual(['user-cart'])
    expect(prisma._dispatches.some((row) => row.userId === 'user-dual')).toBe(false)
  })

  it('an ineligible price drop (e.g. history under 15 days) does not suppress the cart e-mail', async () => {
    const prisma = createPrisma({ dropEvent: 'ineligible' })
    const result = await serviceFor(prisma).notifyDiscountAudience(params)

    expect(result).toEqual({ notified: 2, superseded: 0, skipped: 0 })
  })

  it('running the same campaign again writes nothing new (reservation idempotency)', async () => {
    const prisma = createPrisma({ dropEvent: null })
    const service = serviceFor(prisma)
    await service.notifyDiscountAudience(params)
    const second = await service.notifyDiscountAudience(params)

    expect(second).toEqual({ notified: 0, superseded: 0, skipped: 2 })
    expect(outbox.rows).toHaveLength(2)
  })
})
