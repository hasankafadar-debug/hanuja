// This suite isolates existing campaign behavior with a configured channel. Central fail-closed behavior has dedicated tests.
vi.mock('../../../api/services/marketing-channel.service', () => ({
  getMarketingChannelStatus: async () => ({ canSend: true }),
}))
import { beforeEach, describe, expect, it, vi } from 'vitest'

// campaign-discount.service.ts transitively imports modules that load the api/lib/prisma
// singleton; intercept them the same way other service tests do.
vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))

// Phase 6: the price pipeline runs inline before the cart decision, and each cart e-mail is a
// reservation written with its outbox row. Those modules have their own tests; here they are
// controlled so the service's audience, priority and idempotency logic is tested in isolation.
const pipeline = vi.hoisted(() => ({
  calls: [] as string[],
  processMarkers: vi.fn(),
  materialize: vi.fn(),
  evaluate: vi.fn(),
}))
vi.mock('../../../api/services/price-change-reconcile.service', () => ({
  processPriceChangeMarkers: pipeline.processMarkers,
}))
vi.mock('../../../api/services/price-drop-evaluation.service', () => ({
  materializeDuePredictions: pipeline.materialize,
  evaluatePriceDropCandidates: pipeline.evaluate,
}))

const outbox = vi.hoisted(() => ({ recordNotification: vi.fn() }))
vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: outbox.recordNotification,
  recordNotifications: vi.fn(),
}))

const reservations = vi.hoisted(() => ({
  rows: [] as Array<{ userId: string; productId: string; fingerprint: string; source: string; createdAt: Date }>,
  forced: new Map<string, string>(),
  reserveCampaignEmail: vi.fn(),
}))
vi.mock('../../../api/services/campaign-email-reservation', () => ({
  CAMPAIGN_EMAIL_COOLDOWN_DAYS: 7,
  reserveCampaignEmail: reservations.reserveCampaignEmail,
}))

import {
  buildDiscountFingerprint,
  campaignCartEventKey,
  createCampaignDiscountService,
  CAMPAIGN_EMAIL_COOLDOWN_DAYS,
} from '../../../api/services/campaign-discount.service'

function resetPhase6Mocks() {
  pipeline.calls.length = 0
  pipeline.processMarkers.mockReset().mockImplementation(async () => {
    pipeline.calls.push('markers')
    return { explained: 0, reset: 0, ignored: 0, resetProducts: 0 }
  })
  pipeline.materialize.mockReset().mockImplementation(async () => {
    pipeline.calls.push('materialize')
    return { materialized: 0, candidates: 0 }
  })
  pipeline.evaluate.mockReset().mockImplementation(async () => {
    pipeline.calls.push('evaluate')
    return { products: 0, pending: 0, ineligible: 0, grouped: 0 }
  })
  outbox.recordNotification.mockReset().mockImplementation(async () => {
    pipeline.calls.push('outbox')
  })
  reservations.rows.length = 0
  reservations.forced.clear()
  reservations.reserveCampaignEmail.mockReset().mockImplementation(
    async (
      _tx: unknown,
      input: { userId: string; productId: string; fingerprint: string; source: string; now: Date },
    ) => {
      const forced = reservations.forced.get(`${input.userId}:${input.productId}`)
      if (forced) return { ok: false, reason: forced }
      if (reservations.rows.some((row) => row.userId === input.userId && row.fingerprint === input.fingerprint)) {
        return { ok: false, reason: 'already' }
      }
      const cutoff = input.now.getTime() - 7 * 24 * 60 * 60 * 1000
      if (
        reservations.rows.some(
          (row) =>
            row.userId === input.userId && row.productId === input.productId && row.createdAt.getTime() >= cutoff,
        )
      ) {
        return { ok: false, reason: 'cooldown' }
      }
      reservations.rows.push({ ...input, createdAt: input.now })
      return { ok: true, id: `reservation-${reservations.rows.length}` }
    },
  )
}

interface MockProduct {
  id: string
  sellerId: string
  categoryId: string | null
  name: string
  slug: string
}

interface MockUser {
  id: string
  email: string
  name: string | null
}

interface MockConsent {
  id: string
  userId: string
  emailConsentAt: Date | null
  emailRevokedAt: Date | null
  optOutToken: string
}

interface MockFavorite {
  id: string
  userId: string
  productId: string
  createdAt: Date
}

interface MockCart {
  id: string
  userId: string | null
}

interface MockCartItem {
  id: string
  cartId: string
  productId: string
}

interface MockDiscountRule {
  id: string
  sellerId: string
  scope: 'ALL_PRODUCTS' | 'CATEGORY' | 'PRODUCT'
  categoryId: string | null
  startsAt: Date | null
  createdAt: Date
  products: Array<{ productId: string }>
  seller: { userId: string }
}

type ProductWhere =
  // Every branch carries sellerId (tenant isolation): the PRODUCT scope where-clause
  // and the resolveCartTargets display-data lookup ({ id: { in }, sellerId }) both
  // enforce it, so a foreign product can never surface through either query shape.
  | { sellerId: string; id: { in: string[] } }
  | { sellerId: string; categoryId: string | null }
  | { sellerId: string }

function matchesProductWhere(product: MockProduct | undefined, where: ProductWhere): boolean {
  if (!product) return false
  if ('id' in where) return where.id.in.includes(product.id) && product.sellerId === where.sellerId
  if ('categoryId' in where) return product.sellerId === where.sellerId && product.categoryId === where.categoryId
  return product.sellerId === where.sellerId
}

function createMockPrisma() {
  const now = new Date('2026-07-17T00:00:00.000Z')

  const products: MockProduct[] = [
    { id: 'product-1', sellerId: 'seller-1', categoryId: 'cat-1', name: 'Sandalye', slug: 'sandalye' },
    { id: 'product-2', sellerId: 'seller-1', categoryId: 'cat-1', name: 'Masa', slug: 'masa' },
    { id: 'product-3', sellerId: 'seller-1', categoryId: 'cat-2', name: 'Lamba', slug: 'lamba' },
    { id: 'product-4', sellerId: 'seller-2', categoryId: 'cat-1', name: 'Hali', slug: 'hali' },
  ]

  const users: MockUser[] = [
    { id: 'user-consented', email: 'consented@example.com', name: 'Ayse Yilmaz' },
    { id: 'user-no-consent', email: 'noconsent@example.com', name: 'Mehmet Demir' },
    { id: 'user-revoked', email: 'revoked@example.com', name: 'Can Kaya' },
    { id: 'seller-user-1', email: 'seller-owner@example.com', name: 'Seller Owner' },
    { id: 'user-cart-consented', email: 'cartuser@example.com', name: 'Zeynep Aydin' },
    { id: 'user-only-all', email: 'onlyall@example.com', name: 'Only All' },
    { id: 'user-cross-tenant', email: 'crosstenant@example.com', name: 'Cross Tenant' },
  ]

  const marketingConsents: MockConsent[] = [
    { id: 'consent-consented', userId: 'user-consented', emailConsentAt: now, emailRevokedAt: null, optOutToken: 'token-consented' },
    { id: 'consent-no-consent', userId: 'user-no-consent', emailConsentAt: null, emailRevokedAt: null, optOutToken: 'token-noconsent' },
    { id: 'consent-revoked', userId: 'user-revoked', emailConsentAt: now, emailRevokedAt: now, optOutToken: 'token-revoked' },
    { id: 'consent-seller', userId: 'seller-user-1', emailConsentAt: now, emailRevokedAt: null, optOutToken: 'token-seller' },
    { id: 'consent-cart', userId: 'user-cart-consented', emailConsentAt: now, emailRevokedAt: null, optOutToken: 'token-cart' },
    { id: 'consent-only-all', userId: 'user-only-all', emailConsentAt: now, emailRevokedAt: null, optOutToken: 'token-only-all' },
    { id: 'consent-cross-tenant', userId: 'user-cross-tenant', emailConsentAt: now, emailRevokedAt: null, optOutToken: 'token-cross-tenant' },
  ]

  const favorites: MockFavorite[] = [
    { id: 'fav-1', userId: 'user-consented', productId: 'product-1', createdAt: new Date('2026-07-01') },
    { id: 'fav-2', userId: 'seller-user-1', productId: 'product-1', createdAt: new Date('2026-07-01') },
    { id: 'fav-3', userId: 'user-no-consent', productId: 'product-1', createdAt: new Date('2026-07-01') },
    { id: 'fav-4', userId: 'user-revoked', productId: 'product-1', createdAt: new Date('2026-07-01') },
    { id: 'fav-5', userId: 'user-only-all', productId: 'product-3', createdAt: new Date('2026-07-02') },
    // Favoriter of product-4, which belongs to seller-2 — used to prove a PRODUCT rule
    // owned by seller-1 cannot surface another tenant's product or its favoriters.
    { id: 'fav-6', userId: 'user-cross-tenant', productId: 'product-4', createdAt: new Date('2026-07-02') },
  ]

  const carts: MockCart[] = [
    { id: 'cart-1', userId: 'user-cart-consented' },
    { id: 'cart-2', userId: null }, // guest cart
    { id: 'cart-3', userId: 'user-consented' },
  ]

  const cartItems: MockCartItem[] = [
    { id: 'ci-1', cartId: 'cart-1', productId: 'product-1' },
    { id: 'ci-2', cartId: 'cart-2', productId: 'product-1' }, // guest — must be excluded
    { id: 'ci-3', cartId: 'cart-3', productId: 'product-2' }, // same user as favorite fav-1 — dedupe target
  ]

  const discountRules: MockDiscountRule[] = [
    {
      id: 'rule-product',
      sellerId: 'seller-1',
      scope: 'PRODUCT',
      categoryId: null,
      startsAt: null,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      products: [{ productId: 'product-1' }],
      seller: { userId: 'seller-user-1' },
    },
    {
      id: 'rule-category',
      sellerId: 'seller-1',
      scope: 'CATEGORY',
      categoryId: 'cat-1',
      startsAt: new Date('2026-07-05T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      products: [],
      seller: { userId: 'seller-user-1' },
    },
    {
      id: 'rule-all',
      sellerId: 'seller-1',
      scope: 'ALL_PRODUCTS',
      categoryId: null,
      startsAt: null,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      products: [],
      seller: { userId: 'seller-user-1' },
    },
    {
      id: 'rule-missing',
      sellerId: 'seller-1',
      scope: 'ALL_PRODUCTS',
      categoryId: null,
      startsAt: null,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      products: [],
      seller: { userId: 'seller-user-1' },
    },
    {
      // Owned by seller-1 but its products list has been mis-populated with a
      // seller-2 product (product-4) alongside a legitimate one (product-1).
      id: 'rule-product-cross-tenant',
      sellerId: 'seller-1',
      scope: 'PRODUCT',
      categoryId: null,
      startsAt: null,
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
      products: [{ productId: 'product-1' }, { productId: 'product-4' }],
      seller: { userId: 'seller-user-1' },
    },
  ]

  const dispatches: Array<{
    userId: string
    discountRuleId: string | null
    productId: string | null
    discountFingerprint: string
    source: string
    createdAt: Date
  }> = []

  const priceDropEvents: Array<{ productId: string; status: string; changeAt: Date }> = []

  const prisma = {
    _dispatches: dispatches,
    _priceDropEvents: priceDropEvents,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    priceDropEvent: {
      findMany: vi.fn().mockImplementation(
        async ({
          where,
        }: {
          where: { productId: { in: string[] }; status: { in: string[] }; changeAt: { gte: Date } }
        }) =>
          priceDropEvents
            .filter(
              (event) =>
                where.productId.in.includes(event.productId) &&
                where.status.in.includes(event.status) &&
                event.changeAt.getTime() >= where.changeAt.gte.getTime(),
            )
            .map((event) => ({ productId: event.productId })),
      ),
    },
    discountRule: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'rule-missing-not-found') return null
        return discountRules.find((rule) => rule.id === where.id) ?? null
      }),
    },
    product: {
      findMany: vi.fn().mockImplementation(
        async ({ where, take }: { where: ProductWhere; take?: number }) => {
          const filtered = products
            .filter((product) => matchesProductWhere(product, where))
            .sort((a, b) => a.id.localeCompare(b.id))
          return typeof take === 'number' ? filtered.slice(0, take) : filtered
        },
      ),
    },
    favoriteProduct: {
      findMany: vi.fn().mockImplementation(
        async ({
          where,
          take,
          cursor,
          skip,
        }: {
          where: { product: ProductWhere } | { userId: { in: string[] }; productId: { in: string[] } }
          take?: number
          cursor?: { id: string }
          skip?: number
        }) => {
          if ('userId' in where) {
            return favorites
              .filter(
                (favorite) =>
                  where.userId.in.includes(favorite.userId) && where.productId.in.includes(favorite.productId),
              )
              .map((favorite) => ({ userId: favorite.userId, productId: favorite.productId }))
          }
          let rows = favorites
            .filter((favorite) =>
              matchesProductWhere(products.find((product) => product.id === favorite.productId), where.product),
            )
            .sort((a, b) => a.id.localeCompare(b.id))
          if (cursor) {
            const index = rows.findIndex((favorite) => favorite.id === cursor.id)
            rows = index >= 0 ? rows.slice(index + (skip ?? 0)) : []
          }
          if (typeof take === 'number') rows = rows.slice(0, take)
          return rows.map((favorite) => ({
            ...favorite,
            user: users.find((user) => user.id === favorite.userId)!,
            product: products.find((product) => product.id === favorite.productId)!,
          }))
        },
      ),
    },
    cartItem: {
      findMany: vi.fn().mockImplementation(
        async ({ where }: { where: { productId: { in: string[] } } }) => {
          return cartItems
            .filter((item) => where.productId.in.includes(item.productId))
            .map((item) => ({
              ...item,
              cart: carts.find((cart) => cart.id === item.cartId)!,
            }))
        },
      ),
    },
    user: {
      findMany: vi.fn().mockImplementation(
        async ({
          where,
        }: {
          where: { id: { in: string[] } } | { email: { equals: string; mode: 'insensitive' } }
        }) => {
          if ('id' in where) {
            return users.filter((user) => where.id.in.includes(user.id))
          }
          const target = where.email.equals.toLowerCase()
          return users.filter((user) => user.email.toLowerCase() === target)
        },
      ),
    },
    marketingConsent: {
      findMany: vi.fn().mockImplementation(
        async ({
          where,
        }: {
          where: {
            userId: { in: string[] }
            emailConsentAt?: { not: null }
            emailRevokedAt?: null
          }
        }) => {
          return marketingConsents.filter((consent) => {
            if (!where.userId.in.includes(consent.userId)) return false
            if (where.emailConsentAt && consent.emailConsentAt === null) return false
            if ('emailRevokedAt' in where && consent.emailRevokedAt !== null) return false
            return true
          })
        },
      ),
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { userId?: string; optOutToken?: string } }) => {
          if (where.userId !== undefined) {
            return marketingConsents.find((consent) => consent.userId === where.userId) ?? null
          }
          return marketingConsents.find((consent) => consent.optOutToken === where.optOutToken) ?? null
        },
      ),
      update: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: { emailRevokedAt: Date }
        }) => {
          const consent = marketingConsents.find((entry) => entry.id === where.id)
          if (!consent) throw new Error('Consent not found')
          consent.emailRevokedAt = data.emailRevokedAt
          return consent
        },
      ),
      updateMany: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { userId: { in: string[] }; emailRevokedAt: null }
          data: { emailRevokedAt: Date }
        }) => {
          let count = 0
          for (const consent of marketingConsents) {
            if (!where.userId.in.includes(consent.userId)) continue
            if (consent.emailRevokedAt !== null) continue
            consent.emailRevokedAt = data.emailRevokedAt
            count += 1
          }
          return { count }
        },
      ),
    },
    campaignEmailDispatch: {
      findMany: vi.fn().mockImplementation(
        async ({
          where,
        }: {
          where: {
            userId: { in: string[] }
            productId: { in: Array<string | null> }
            createdAt: { gte: Date }
          }
        }) => {
          return dispatches
            .filter((dispatch) => {
              if (!where.userId.in.includes(dispatch.userId)) return false
              if (dispatch.productId === null || !where.productId.in.includes(dispatch.productId)) return false
              if (dispatch.createdAt.getTime() < where.createdAt.gte.getTime()) return false
              return true
            })
            .map((dispatch) => ({ userId: dispatch.userId, productId: dispatch.productId }))
        },
      ),
      create: vi.fn().mockImplementation(
        async ({
          data,
        }: {
          data: {
            userId: string
            discountRuleId: string | null
            productId?: string | null
            discountFingerprint: string
            source: string
          }
        }) => {
          const exists = dispatches.some(
            (dispatch) =>
              dispatch.userId === data.userId &&
              dispatch.discountFingerprint === data.discountFingerprint &&
              dispatch.source === data.source,
          )
          if (exists) {
            throw new Error('Unique constraint violation: campaign_email_dispatches_userId_discountFingerprint_source_key')
          }
          const row = {
            userId: data.userId,
            discountRuleId: data.discountRuleId,
            productId: data.productId ?? null,
            discountFingerprint: data.discountFingerprint,
            source: data.source,
            createdAt: new Date(),
          }
          dispatches.push(row)
          return { id: `dispatch-${dispatches.length}`, ...row }
        },
      ),
    },
  }
  return prisma
}

describe('buildDiscountFingerprint', () => {
  it('uses startsAt when present', () => {
    const rule = { id: 'rule-1', startsAt: new Date('2026-07-05T00:00:00.000Z'), createdAt: new Date('2026-07-01T00:00:00.000Z') }
    expect(buildDiscountFingerprint(rule)).toBe('rule-1:2026-07-05T00:00:00.000Z')
  })

  it('falls back to createdAt when startsAt is null', () => {
    const rule = { id: 'rule-2', startsAt: null, createdAt: new Date('2026-07-01T00:00:00.000Z') }
    expect(buildDiscountFingerprint(rule)).toBe('rule-2:2026-07-01T00:00:00.000Z')
  })
})

describe('CampaignDiscountService.resolveTargets', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    resetPhase6Mocks()
    prisma = createMockPrisma()
    service = createCampaignDiscountService({ prisma: prisma as never })
  })

  it('returns empty result when the discount rule does not exist', async () => {
    const targets = await service.resolveTargets('rule-missing-not-found')
    expect(targets).toEqual([])
  })

  it('resolves PRODUCT scope to cart holders only — favoriting alone is no reason any more (phase 6)', async () => {
    const targets = await service.resolveTargets('rule-product')

    // product-1 has 4 favoriters and 2 cart holders (cart-consented, guest). Only the
    // consented, non-guest cart holder remains; favoriters get the lowest-price e-mail instead.
    expect(targets.map((target) => target.userId)).toEqual(['user-cart-consented'])
    expect(targets[0]).toMatchObject({ source: 'cart', productId: 'product-1' })
    expect(prisma.favoriteProduct.findMany).not.toHaveBeenCalled()
  })

  it('does not surface another tenant product even if a DiscountRuleProduct row points at it', async () => {
    const targets = await service.resolveTargets('rule-product-cross-tenant')

    expect(targets.some((target) => target.productId === 'product-4')).toBe(false)
    expect(targets.some((target) => target.userId === 'user-cross-tenant')).toBe(false)
    expect(
      targets.some((target) => target.userId === 'user-cart-consented' && target.productId === 'product-1'),
    ).toBe(true)
  })

  it('excludes the seller own account, unconsented users and guest carts', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.some((target) => target.userId === 'seller-user-1')).toBe(false)
    expect(targets.some((target) => target.userId === 'user-no-consent')).toBe(false)
    expect(targets.some((target) => target.userId === 'user-revoked')).toBe(false)
    expect(targets.filter((target) => target.source === 'cart').map((target) => target.userId)).toEqual([
      'user-cart-consented',
    ])
  })

  it('resolves CATEGORY scope to cart holders of the seller products in that category', async () => {
    const targets = await service.resolveTargets('rule-category')

    // user-consented has product-2 (cat-1) in cart-3; user-cart-consented has product-1 in cart-1.
    expect(targets.map((target) => target.userId).sort()).toEqual(['user-cart-consented', 'user-consented'])
    expect(targets.every((target) => target.source === 'cart')).toBe(true)
    expect(targets.some((target) => target.productId === 'product-4')).toBe(false)
  })

  it('does not include favorite-only users for ALL_PRODUCTS scope', async () => {
    const targets = await service.resolveTargets('rule-all')

    // user-only-all only favorited product-3 — no cart — so no cart e-mail.
    expect(targets.some((target) => target.userId === 'user-only-all')).toBe(false)
    expect(targets.some((target) => target.productId === 'product-4')).toBe(false)
  })
})

describe('CampaignDiscountService.notifyDiscountAudience', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let service: ReturnType<typeof createCampaignDiscountService>
  const NOW = new Date('2026-07-17T12:00:00.000Z')

  beforeEach(() => {
    resetPhase6Mocks()
    prisma = createMockPrisma()
    service = createCampaignDiscountService({ prisma: prisma as never })
  })

  it('reserves and writes one outbox row per cart target in the same transaction', async () => {
    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
      now: NOW,
    })

    expect(result).toEqual({ notified: 1, superseded: 0, skipped: 0 })
    expect(reservations.reserveCampaignEmail).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'user-cart-consented',
        productId: 'product-1',
        source: 'cart',
        fingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
        eventKey: campaignCartEventKey('rule-product:2026-07-10T00:00:00.000Z', 'user-cart-consented'),
      }),
    )
    expect(outbox.recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'user-cart-consented',
        type: 'product_discount_in_cart',
        eventKey: campaignCartEventKey('rule-product:2026-07-10T00:00:00.000Z', 'user-cart-consented'),
        emailTo: 'cartuser@example.com',
        data: expect.objectContaining({ unsubscribeUrl: expect.stringContaining('token-cart') }),
      }),
    )
    expect(outbox.recordNotification).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'product_discount_favorited' }),
    )
  })

  it('brings the price pipeline up to date before deciding (deterministic priority)', async () => {
    await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
      now: NOW,
    })

    expect(pipeline.calls.slice(0, 3)).toEqual(['markers', 'materialize', 'evaluate'])
    expect(pipeline.calls.indexOf('outbox')).toBeGreaterThan(pipeline.calls.indexOf('evaluate'))
    expect(pipeline.processMarkers).toHaveBeenCalledWith(prisma, {
      scope: { productIds: ['product-1'], sellerIds: ['seller-1'] },
    })
    expect(pipeline.materialize).toHaveBeenCalledWith(prisma, { productIds: ['product-1'] })
  })

  it('gives way to the lowest-price e-mail for a favoriter with an eligible price drop of this campaign', async () => {
    // user-consented has product-2 in its cart; make it also favorite product-2 and give
    // product-2 a pending lowest-price event after the campaign start.
    prisma.favoriteProduct.findMany.mockImplementationOnce(async () => [
      { userId: 'user-consented', productId: 'product-2' },
    ])
    prisma._priceDropEvents.push({
      productId: 'product-2',
      status: 'pending',
      changeAt: new Date('2026-07-05T00:00:01.000Z'),
    })

    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-category',
      discountFingerprint: 'rule-category:2026-07-05T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
      now: NOW,
    })

    expect(result).toEqual({ notified: 1, superseded: 1, skipped: 0 })
    expect(reservations.reserveCampaignEmail).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-consented' }),
    )
  })

  it('still sends the cart e-mail when the price drop of this product was not eligible', async () => {
    prisma._priceDropEvents.push({
      productId: 'product-2',
      status: 'ineligible',
      changeAt: new Date('2026-07-05T00:00:01.000Z'),
    })

    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-category',
      discountFingerprint: 'rule-category:2026-07-05T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
      now: NOW,
    })

    expect(result).toEqual({ notified: 2, superseded: 0, skipped: 0 })
  })

  it('is idempotent: re-running for the same fingerprint writes nothing new', async () => {
    const params = {
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
      now: NOW,
    }

    expect(await service.notifyDiscountAudience(params)).toEqual({ notified: 1, superseded: 0, skipped: 0 })
    expect(await service.notifyDiscountAudience(params)).toEqual({ notified: 0, superseded: 0, skipped: 1 })
    expect(outbox.recordNotification).toHaveBeenCalledTimes(1)
  })

  it('a reservation refused by the shared limits writes no outbox row', async () => {
    reservations.forced.set('user-cart-consented:product-1', 'daily_cap')

    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product-recreated:2026-07-11T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
      now: NOW,
    })

    expect(result).toEqual({ notified: 0, superseded: 0, skipped: 1 })
    expect(outbox.recordNotification).not.toHaveBeenCalled()
  })

  it('keeps the 7-day cooldown constant shared with the reservation module', () => {
    expect(CAMPAIGN_EMAIL_COOLDOWN_DAYS).toBe(7)
  })

  it('returns zero without side effects when there is no audience', async () => {
    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-missing-not-found',
      discountFingerprint: 'rule-missing-not-found:2026-07-01T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    expect(result).toEqual({ notified: 0, superseded: 0, skipped: 0 })
    expect(reservations.reserveCampaignEmail).not.toHaveBeenCalled()
    expect(outbox.recordNotification).not.toHaveBeenCalled()
  })
})

describe('CampaignDiscountService.revokeMarketingEmailConsentByToken', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createMockPrisma()
    service = createCampaignDiscountService({ prisma: prisma as never, notifications: { send: vi.fn() } as never })
  })

  it('revokes consent for a valid token', async () => {
    const result = await service.revokeMarketingEmailConsentByToken('token-consented')
    expect(result).toEqual({ revoked: true })

    const consent = await prisma.marketingConsent.findUnique({ where: { userId: 'user-consented' } })
    expect(consent?.emailRevokedAt).not.toBeNull()
  })

  it('returns null for an invalid token', async () => {
    const result = await service.revokeMarketingEmailConsentByToken('does-not-exist')
    expect(result).toBeNull()
  })

  it('is idempotent: re-revoking an already-revoked token still succeeds', async () => {
    const first = await service.revokeMarketingEmailConsentByToken('token-revoked')
    const second = await service.revokeMarketingEmailConsentByToken('token-revoked')

    expect(first).toEqual({ revoked: true })
    expect(second).toEqual({ revoked: true })
    // Already revoked at intake — update should not be called again for this path.
    expect(prisma.marketingConsent.update).not.toHaveBeenCalled()
  })

  it('returns null for a blank token', async () => {
    const result = await service.revokeMarketingEmailConsentByToken('   ')
    expect(result).toBeNull()
  })
})

interface MockConsentRow {
  id: string
  userId: string
  emailConsentAt: Date | null
  emailRevokedAt: Date | null
  smsConsentAt: Date | null
  smsRevokedAt: Date | null
  consentSource: string
  optOutToken: string
}

/**
 * Lightweight prisma mock covering only the marketingConsent operations the
 * user-facing consent functions touch (upsert / updateMany-by-userId /
 * findUnique-by-userId). Kept separate from createMockPrisma so the
 * campaign-audience mock's updateMany contract (userId.in) stays untouched.
 */
function createConsentMockPrisma(seed: MockConsentRow[] = []) {
  const rows: MockConsentRow[] = seed.map((row) => ({ ...row }))

  return {
    _rows: rows,
    marketingConsent: {
      upsert: vi.fn().mockImplementation(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId: string }
          create: Partial<MockConsentRow> & { userId: string; optOutToken: string }
          update: Partial<MockConsentRow>
        }) => {
          const existing = rows.find((row) => row.userId === where.userId)
          if (existing) {
            Object.assign(existing, update)
            return existing
          }
          const row: MockConsentRow = {
            id: `consent-${rows.length + 1}`,
            userId: create.userId,
            emailConsentAt: create.emailConsentAt ?? null,
            emailRevokedAt: create.emailRevokedAt ?? null,
            smsConsentAt: create.smsConsentAt ?? null,
            smsRevokedAt: create.smsRevokedAt ?? null,
            consentSource: create.consentSource ?? 'signup',
            optOutToken: create.optOutToken,
          }
          rows.push(row)
          return row
        },
      ),
      updateMany: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { userId: string }
          data: Partial<MockConsentRow>
        }) => {
          let count = 0
          for (const row of rows) {
            if (row.userId !== where.userId) continue
            Object.assign(row, data)
            count += 1
          }
          return { count }
        },
      ),
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { userId: string } }) =>
          rows.find((row) => row.userId === where.userId) ?? null,
      ),
    },
  }
}

describe('CampaignDiscountService.grantMarketingConsent', () => {
  it('creates a consent row with both channels opted in and an opt-out token', async () => {
    const prisma = createConsentMockPrisma()
    const service = createCampaignDiscountService({
      prisma: prisma as never,
      notifications: { send: vi.fn() } as never,
    })

    await service.grantMarketingConsent({ userId: 'user-1', source: 'signup' })

    expect(prisma._rows).toHaveLength(1)
    const row = prisma._rows[0]!
    expect(row.emailConsentAt).not.toBeNull()
    expect(row.smsConsentAt).not.toBeNull()
    expect(row.emailRevokedAt).toBeNull()
    expect(row.smsRevokedAt).toBeNull()
    expect(row.consentSource).toBe('signup')
    expect(row.optOutToken.length).toBeGreaterThan(0)
  })

  it('re-grants an existing revoked consent by clearing both RevokedAt flags and updating the source', async () => {
    const revokedAt = new Date('2026-07-01T00:00:00.000Z')
    const prisma = createConsentMockPrisma([
      {
        id: 'consent-existing',
        userId: 'user-1',
        emailConsentAt: revokedAt,
        emailRevokedAt: revokedAt,
        smsConsentAt: revokedAt,
        smsRevokedAt: revokedAt,
        consentSource: 'signup',
        optOutToken: 'token-existing',
      },
    ])
    const service = createCampaignDiscountService({
      prisma: prisma as never,
      notifications: { send: vi.fn() } as never,
    })

    await service.grantMarketingConsent({ userId: 'user-1', source: 'account_settings' })

    expect(prisma._rows).toHaveLength(1)
    const row = prisma._rows[0]!
    expect(row.emailRevokedAt).toBeNull()
    expect(row.smsRevokedAt).toBeNull()
    expect(row.consentSource).toBe('account_settings')
    expect(row.optOutToken).toBe('token-existing') // token preserved on re-grant
  })

  it('is idempotent when granted twice', async () => {
    const prisma = createConsentMockPrisma()
    const service = createCampaignDiscountService({
      prisma: prisma as never,
      notifications: { send: vi.fn() } as never,
    })

    await service.grantMarketingConsent({ userId: 'user-1', source: 'signup' })
    await service.grantMarketingConsent({ userId: 'user-1', source: 'account_settings' })

    expect(prisma._rows).toHaveLength(1)
  })
})

describe('CampaignDiscountService.revokeMarketingConsentByUser', () => {
  it('revokes both channels for the user', async () => {
    const consentAt = new Date('2026-07-01T00:00:00.000Z')
    const prisma = createConsentMockPrisma([
      {
        id: 'consent-1',
        userId: 'user-1',
        emailConsentAt: consentAt,
        emailRevokedAt: null,
        smsConsentAt: consentAt,
        smsRevokedAt: null,
        consentSource: 'signup',
        optOutToken: 'token-1',
      },
    ])
    const service = createCampaignDiscountService({
      prisma: prisma as never,
      notifications: { send: vi.fn() } as never,
    })

    await service.revokeMarketingConsentByUser({ userId: 'user-1' })

    const row = prisma._rows[0]!
    expect(row.emailRevokedAt).not.toBeNull()
    expect(row.smsRevokedAt).not.toBeNull()
  })

  it('is a no-op success when the user has no consent row', async () => {
    const prisma = createConsentMockPrisma()
    const service = createCampaignDiscountService({
      prisma: prisma as never,
      notifications: { send: vi.fn() } as never,
    })

    await expect(service.revokeMarketingConsentByUser({ userId: 'user-none' })).resolves.toBeUndefined()
    expect(prisma._rows).toHaveLength(0)
  })
})

describe('CampaignDiscountService.getMarketingConsentStatus', () => {
  function serviceFor(seed: MockConsentRow[]) {
    const prisma = createConsentMockPrisma(seed)
    return createCampaignDiscountService({
      prisma: prisma as never,
      notifications: { send: vi.fn() } as never,
    })
  }

  const now = new Date('2026-07-01T00:00:00.000Z')

  it('reports not consented when there is no row', async () => {
    const service = serviceFor([])
    expect(await service.getMarketingConsentStatus({ userId: 'user-none' })).toEqual({
      emailConsented: false,
      smsConsented: false,
    })
  })

  it('reports consented when ConsentAt is set and RevokedAt is null', async () => {
    const service = serviceFor([
      {
        id: 'c1',
        userId: 'user-1',
        emailConsentAt: now,
        emailRevokedAt: null,
        smsConsentAt: now,
        smsRevokedAt: null,
        consentSource: 'signup',
        optOutToken: 't1',
      },
    ])
    expect(await service.getMarketingConsentStatus({ userId: 'user-1' })).toEqual({
      emailConsented: true,
      smsConsented: true,
    })
  })

  it('reports not consented when the channel is revoked', async () => {
    const service = serviceFor([
      {
        id: 'c1',
        userId: 'user-1',
        emailConsentAt: now,
        emailRevokedAt: now,
        smsConsentAt: now,
        smsRevokedAt: now,
        consentSource: 'signup',
        optOutToken: 't1',
      },
    ])
    expect(await service.getMarketingConsentStatus({ userId: 'user-1' })).toEqual({
      emailConsented: false,
      smsConsented: false,
    })
  })
})

describe('CampaignDiscountService.revokeMarketingEmailConsentByEmail', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createMockPrisma()
    service = createCampaignDiscountService({ prisma: prisma as never, notifications: { send: vi.fn() } as never })
  })

  it('revokes consent for every account matching the email address', async () => {
    const count = await service.revokeMarketingEmailConsentByEmail('consented@example.com')
    expect(count).toBe(1)

    const consent = await prisma.marketingConsent.findUnique({ where: { userId: 'user-consented' } })
    expect(consent?.emailRevokedAt).not.toBeNull()
  })

  it('is a no-op when no user matches the email', async () => {
    const count = await service.revokeMarketingEmailConsentByEmail('nobody@example.com')
    expect(count).toBe(0)
  })

  it('is idempotent: re-running for an already-revoked consent updates zero rows', async () => {
    const first = await service.revokeMarketingEmailConsentByEmail('revoked@example.com')
    const second = await service.revokeMarketingEmailConsentByEmail('revoked@example.com')

    expect(first).toBe(0) // already revoked at intake
    expect(second).toBe(0)
  })

  it('returns 0 for a blank email', async () => {
    const count = await service.revokeMarketingEmailConsentByEmail('  ')
    expect(count).toBe(0)
  })
})
