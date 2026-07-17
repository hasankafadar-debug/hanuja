/**
 * Integration test — campaign discount cross-source dedupe end to end.
 *
 * Invariant (campaign-discount.service resolveTargets contract): a user who both
 * favorited AND has-in-cart the same discounted product is a single human and
 * must be notified exactly once, under the 'favorite' source (favorite wins over
 * cart). This test drives the full notify path — resolveTargets → dispatch row →
 * notification send — and asserts the collapse survives all the way to the
 * emitted notification type, not just the intermediate target list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

// See note in campaign-consent-enforcement.test.ts — intercept the transitive
// prisma-singleton import pulled in by createNotificationService.
vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))

import { createCampaignDiscountService } from '../../api/services/campaign-discount.service'

interface MockUser {
  id: string
  email: string
  name: string | null
}

const CONSENT_AT = new Date('2026-07-01T00:00:00.000Z')

/**
 * Fixture: a single-product PRODUCT-scope rule on product-1, with
 *   - user-dual : favorites product-1 AND has product-1 in cart → dedupe target
 *   - user-cart : only has product-1 in cart                    → 'cart' source
 * both fully opted-in, so the only collapse under test is the source dedupe.
 */
function createDedupePrisma() {
  const product = { id: 'product-1', name: 'Rattan Salıncak', slug: 'rattan-salincak' }

  const users: MockUser[] = [
    { id: 'user-dual', email: 'nazli.dual@example.com', name: 'Nazlı Ünal' },
    { id: 'user-cart', email: 'kerem.cart@example.com', name: 'Kerem Bal' },
    { id: 'seller-user-1', email: 'magaza@example.com', name: 'Mağaza Sahibi' },
  ]

  const consents = [
    { userId: 'user-dual', emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-dual' },
    { userId: 'user-cart', emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-cart' },
    { userId: 'seller-user-1', emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-seller' },
  ]

  const favorites = [{ userId: 'user-dual', createdAt: new Date('2026-07-06') }]

  const cartItems = [
    { productId: 'product-1', cart: { userId: 'user-dual' } },
    { productId: 'product-1', cart: { userId: 'user-cart' } },
  ]

  const dispatches: Array<{
    userId: string
    productId: string | null
    discountFingerprint: string
    source: string
    createdAt: Date
  }> = []

  const prisma = {
    _dispatches: dispatches,
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
    product: {
      findMany: vi.fn(async () => [{ id: product.id, name: product.name, slug: product.slug }]),
    },
    favoriteProduct: {
      findMany: vi.fn(async () =>
        favorites.map((favorite) => ({
          userId: favorite.userId,
          user: users.find((user) => user.id === favorite.userId)!,
          product,
        })),
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
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { userId: { in: string[] }; emailConsentAt?: { not: null }; emailRevokedAt?: null }
        }) =>
          consents.filter((consent) => {
            if (!where.userId.in.includes(consent.userId)) return false
            if (where.emailConsentAt && consent.emailConsentAt === null) return false
            if ('emailRevokedAt' in where && consent.emailRevokedAt !== null) return false
            return true
          }),
      ),
    },
    campaignEmailDispatch: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { userId: { in: string[] }; productId: { in: Array<string | null> }; createdAt: { gte: Date } }
        }) =>
          dispatches
            .filter(
              (dispatch) =>
                where.userId.in.includes(dispatch.userId) &&
                dispatch.productId !== null &&
                where.productId.in.includes(dispatch.productId) &&
                dispatch.createdAt.getTime() >= where.createdAt.gte.getTime(),
            )
            .map((dispatch) => ({ userId: dispatch.userId, productId: dispatch.productId })),
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { userId: string; productId?: string | null; discountFingerprint: string; source: string }
        }) => {
          const exists = dispatches.some(
            (dispatch) =>
              dispatch.userId === data.userId &&
              dispatch.discountFingerprint === data.discountFingerprint &&
              dispatch.source === data.source,
          )
          if (exists) throw new Error('Unique constraint violation')
          dispatches.push({
            userId: data.userId,
            productId: data.productId ?? null,
            discountFingerprint: data.discountFingerprint,
            source: data.source,
            createdAt: new Date(),
          })
          return { id: `dispatch-${dispatches.length}`, ...data }
        },
      ),
    },
  }

  return prisma
}

describe('campaign discount — cross-source dedupe (favorite over cart)', () => {
  let prisma: ReturnType<typeof createDedupePrisma>
  let sendMock: ReturnType<typeof vi.fn>
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createDedupePrisma()
    sendMock = vi.fn()
    service = createCampaignDiscountService({
      prisma: prisma as unknown as PrismaClient,
      notifications: { send: sendMock } as never,
    })
  })

  it('resolves the dual-source user once, as a favorite', async () => {
    const targets = await service.resolveTargets('rule-product')

    const dualEntries = targets.filter((target) => target.userId === 'user-dual')
    expect(dualEntries).toHaveLength(1)
    expect(dualEntries[0]?.source).toBe('favorite')

    // The cart-only user still surfaces, under 'cart'.
    const cartEntry = targets.find((target) => target.userId === 'user-cart')
    expect(cartEntry?.source).toBe('cart')
  })

  it('sends the dual-source user exactly one notification, typed as product_discount_favorited', async () => {
    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atölye Kuzey',
    })

    // 2 distinct humans: user-dual (favorite) + user-cart (cart).
    expect(result).toEqual({ notified: 2 })

    const dualSends = sendMock.mock.calls
      .map((call) => call[0] as { userId: string; type: string })
      .filter((payload) => payload.userId === 'user-dual')
    expect(dualSends).toHaveLength(1)
    expect(dualSends[0]?.type).toBe('product_discount_favorited')

    // Exactly one dispatch row for the dual user, under the favorite source.
    const dualDispatches = prisma._dispatches.filter((dispatch) => dispatch.userId === 'user-dual')
    expect(dualDispatches).toHaveLength(1)
    expect(dualDispatches[0]?.source).toBe('favorite')

    // The cart-only user is dispatched under 'cart' — the collapse is per-user, not global.
    const cartSends = sendMock.mock.calls
      .map((call) => call[0] as { userId: string; type: string })
      .filter((payload) => payload.userId === 'user-cart')
    expect(cartSends).toHaveLength(1)
    expect(cartSends[0]?.type).toBe('product_discount_in_cart')
  })
})
