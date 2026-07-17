import { beforeEach, describe, expect, it, vi } from 'vitest'

// campaign-discount.service.ts imports createNotificationService as a default-param
// fallback. That module transitively imports api/jobs/notification-dispatch.job,
// which imports the api/lib/prisma singleton (`new PrismaClient()` at module load).
// Every test here overrides `notifications`, but the import chain still runs at
// module-load time, so it must be intercepted the same way other service tests do.
vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))

import {
  buildDiscountFingerprint,
  createCampaignDiscountService,
  CAMPAIGN_EMAIL_COOLDOWN_DAYS,
} from '../../../api/services/campaign-discount.service'

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

  return {
    _dispatches: dispatches,
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
          where: { product: ProductWhere }
          take?: number
          cursor?: { id: string }
          skip?: number
        }) => {
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
    prisma = createMockPrisma()
    service = createCampaignDiscountService({ prisma: prisma as never, notifications: { send: vi.fn() } as never })
  })

  it('returns empty result when the discount rule does not exist', async () => {
    const targets = await service.resolveTargets('rule-missing-not-found')
    expect(targets).toEqual([])
  })

  it('resolves PRODUCT scope to favoriters and cart-holders of the exact product, excluding seller and unconsented users', async () => {
    const targets = await service.resolveTargets('rule-product')

    // product-1 has 4 favoriters (consented, seller-self, no-consent, revoked) and 2 cart
    // holders (cart-consented, guest). After self-exclusion, consent filtering, and guest
    // exclusion, only user-consented (favorite) and user-cart-consented (cart) remain.
    expect(targets.map((target) => target.userId).sort()).toEqual(['user-cart-consented', 'user-consented'])

    const favoriteTarget = targets.find((target) => target.userId === 'user-consented')
    expect(favoriteTarget).toMatchObject({ source: 'favorite', productId: 'product-1' })

    const cartTarget = targets.find((target) => target.userId === 'user-cart-consented')
    expect(cartTarget).toMatchObject({ source: 'cart', productId: 'product-1' })
  })

  it('does not surface another tenant product or its favoriters even if a DiscountRuleProduct row points at it', async () => {
    // rule-product-cross-tenant (owned by seller-1) lists product-1 (seller-1) and
    // product-4 (seller-2). The PRODUCT scope where-clause is constrained by sellerId,
    // so product-4 — and user-cross-tenant who favorited it — must never appear.
    const targets = await service.resolveTargets('rule-product-cross-tenant')

    expect(targets.some((target) => target.productId === 'product-4')).toBe(false)
    expect(targets.some((target) => target.userId === 'user-cross-tenant')).toBe(false)

    // The legitimate same-seller product still resolves normally.
    expect(targets.some((target) => target.userId === 'user-consented' && target.productId === 'product-1')).toBe(
      true,
    )
  })

  it('excludes the seller own account from the audience', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.some((target) => target.userId === 'seller-user-1')).toBe(false)
  })

  it('excludes users without marketing consent or with revoked consent', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.some((target) => target.userId === 'user-no-consent')).toBe(false)
    expect(targets.some((target) => target.userId === 'user-revoked')).toBe(false)
  })

  it('excludes guest cart items (no user account to notify)', async () => {
    const targets = await service.resolveTargets('rule-product')
    // guest cart (cart-2) also holds product-1, but has no userId — must not surface as a
    // target. The only cart-sourced target for product-1 is the non-guest cart-1 holder.
    const cartSourcedUserIds = targets.filter((target) => target.source === 'cart').map((target) => target.userId)
    expect(cartSourcedUserIds).toEqual(['user-cart-consented'])
  })

  it('resolves CATEGORY scope to the seller products in that category and dedupes favorite over cart', async () => {
    const targets = await service.resolveTargets('rule-category')

    // user-consented favorited product-1 AND has product-2 in cart (cart-3) — both in cat-1 scope.
    // Must be deduped to a single 'favorite' entry.
    const consentedEntries = targets.filter((target) => target.userId === 'user-consented')
    expect(consentedEntries).toHaveLength(1)
    expect(consentedEntries[0]?.source).toBe('favorite')

    // user-cart-consented only has a cart hit (product-1, cart-1) — surfaces as 'cart'.
    const cartEntry = targets.find((target) => target.userId === 'user-cart-consented')
    expect(cartEntry?.source).toBe('cart')

    // product-3 is cat-2, out of CATEGORY(cat-1) scope — user-only-all must not appear.
    expect(targets.some((target) => target.userId === 'user-only-all')).toBe(false)

    // product-4 belongs to seller-2 — never in scope for a seller-1 rule.
    expect(targets.some((target) => target.productId === 'product-4')).toBe(false)
  })

  it('resolves ALL_PRODUCTS scope to every seller product, including categories CATEGORY scope would miss', async () => {
    const targets = await service.resolveTargets('rule-all')

    expect(targets.some((target) => target.userId === 'user-only-all' && target.productId === 'product-3')).toBe(
      true,
    )
    expect(targets.some((target) => target.productId === 'product-4')).toBe(false)
  })
})

describe('CampaignDiscountService favorites pagination (unbounded audience)', () => {
  const FAVORITE_COUNT = 1200 // exceeds the service's internal page size (1000)

  function createLargeFavoritesPrisma() {
    const product = { id: 'product-big', name: 'Popüler Ürün', slug: 'populer-urun' }
    const rule = {
      id: 'rule-big',
      sellerId: 'seller-big',
      scope: 'PRODUCT' as const,
      categoryId: null,
      startsAt: null,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      products: [{ productId: product.id }],
      seller: { userId: 'seller-big-owner' },
    }

    const favorites = Array.from({ length: FAVORITE_COUNT }, (_, index) => ({
      id: `fav-big-${String(index).padStart(5, '0')}`,
      userId: `user-big-${index}`,
      productId: product.id,
      createdAt: new Date('2026-07-01'),
    }))

    return {
      discountRule: { findUnique: vi.fn().mockResolvedValue(rule) },
      product: { findMany: vi.fn().mockResolvedValue([{ id: product.id, name: product.name, slug: product.slug }]) },
      favoriteProduct: {
        findMany: vi.fn().mockImplementation(
          async ({
            take,
            cursor,
            skip,
          }: {
            take?: number
            cursor?: { id: string }
            skip?: number
          }) => {
            let rows = favorites
            if (cursor) {
              const index = rows.findIndex((favorite) => favorite.id === cursor.id)
              rows = index >= 0 ? rows.slice(index + (skip ?? 0)) : []
            }
            if (typeof take === 'number') rows = rows.slice(0, take)
            return rows.map((favorite) => ({
              ...favorite,
              user: { id: favorite.userId, email: `${favorite.userId}@example.com`, name: null },
              product,
            }))
          },
        ),
      },
      cartItem: { findMany: vi.fn().mockResolvedValue([]) },
      user: {
        findMany: vi.fn().mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, email: `${id}@example.com`, name: null })),
        ),
      },
      marketingConsent: {
        findMany: vi.fn().mockImplementation(async ({ where }: { where: { userId: { in: string[] } } }) =>
          where.userId.in.map((userId) => ({ userId })),
        ),
      },
    }
  }

  it('paginates past the internal page size and includes users from the second page', async () => {
    const prisma = createLargeFavoritesPrisma()
    const service = createCampaignDiscountService({ prisma: prisma as never, notifications: { send: vi.fn() } as never })

    const targets = await service.resolveTargets('rule-big')

    expect(targets).toHaveLength(FAVORITE_COUNT)
    // user-big-1050 only exists on the second internal page (page size 1000).
    expect(targets.some((target) => target.userId === 'user-big-1050')).toBe(true)
    expect(prisma.favoriteProduct.findMany).toHaveBeenCalledTimes(2) // two pages drained
  })
})

describe('CampaignDiscountService.notifyDiscountAudience', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let sendMock: ReturnType<typeof vi.fn>
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createMockPrisma()
    sendMock = vi.fn()
    service = createCampaignDiscountService({ prisma: prisma as never, notifications: { send: sendMock } as never })
  })

  it('creates a dispatch row and sends a notification per resolved target', async () => {
    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    // rule-product resolves to 2 targets: user-consented (favorite) + user-cart-consented (cart).
    expect(result).toEqual({ notified: 2 })
    expect(prisma.campaignEmailDispatch.create).toHaveBeenCalledTimes(2)
    expect(sendMock).toHaveBeenCalledTimes(2)
    // Each dispatch row records the productId so the cooldown scan can key on it.
    expect(prisma._dispatches.map((dispatch) => dispatch.productId)).toEqual(['product-1', 'product-1'])
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-consented',
        type: 'product_discount_favorited',
        emailTo: 'consented@example.com',
        data: expect.objectContaining({
          unsubscribeUrl: expect.stringContaining('token-consented'),
        }),
      }),
    )
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-cart-consented',
        type: 'product_discount_in_cart',
        emailTo: 'cartuser@example.com',
        data: expect.objectContaining({
          unsubscribeUrl: expect.stringContaining('token-cart'),
        }),
      }),
    )
  })

  it('is idempotent: re-running for the same fingerprint skips already-dispatched users', async () => {
    const params = {
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    }

    const first = await service.notifyDiscountAudience(params)
    const second = await service.notifyDiscountAudience(params)

    expect(first).toEqual({ notified: 2 })
    expect(second).toEqual({ notified: 0 })
    expect(sendMock).toHaveBeenCalledTimes(2)
    // The cooldown check now short-circuits before the create attempt, so the second
    // call never reaches campaignEmailDispatch.create for these already-dispatched users.
    expect(prisma.campaignEmailDispatch.create).toHaveBeenCalledTimes(2)
  })

  it('does not throw when the unique constraint rejects a duplicate dispatch', async () => {
    const params = {
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    }

    await service.notifyDiscountAudience(params)
    await expect(service.notifyDiscountAudience(params)).resolves.toEqual({ notified: 0 })
  })

  it('cooldown blocks a new fingerprint (rule recreated) for the same user+product within 7 days — the recreate-to-respam scenario', async () => {
    const first = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })
    expect(first).toEqual({ notified: 2 })

    // Simulates delete+recreate of the rule: audience resolution is by product scope
    // (same underlying rule-product fixture), but the fingerprint is brand-new — as it
    // would be for a freshly-created rule row with a new id/startsAt.
    const second = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product-recreated:2026-07-11T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    expect(second).toEqual({ notified: 0 })
    expect(sendMock).toHaveBeenCalledTimes(2) // no new sends on the second call
    expect(prisma.campaignEmailDispatch.create).toHaveBeenCalledTimes(2) // no new dispatch rows
  })

  it('sends again once the cooldown window has elapsed, even for a new fingerprint', async () => {
    await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    // Rewind the recorded dispatch timestamps past the cooldown window.
    const staleCutoff = new Date(Date.now() - (CAMPAIGN_EMAIL_COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000)
    for (const dispatch of prisma._dispatches) dispatch.createdAt = staleCutoff

    const second = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product-recreated:2026-08-01T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    expect(second).toEqual({ notified: 2 })
    expect(sendMock).toHaveBeenCalledTimes(4)
  })

  it('does not apply the cooldown across different products for the same user', async () => {
    // rule-category (scope CATEGORY cat-1) includes product-1 and product-2; notify once.
    await service.notifyDiscountAudience({
      discountRuleId: 'rule-category',
      discountFingerprint: 'rule-category:2026-07-05T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })
    const firstSendCount = sendMock.mock.calls.length

    // A distinct PRODUCT-scope rule for product-2 (different product than product-1's
    // dispatch history but may overlap on user) must not be blocked by the cooldown.
    await service.notifyDiscountAudience({
      discountRuleId: 'rule-all',
      discountFingerprint: 'rule-all:2026-07-02T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    // rule-all (ALL_PRODUCTS) reaches user-only-all on product-3 — a product never
    // dispatched before — so it must send regardless of the rule-category cooldown.
    expect(sendMock.mock.calls.length).toBeGreaterThan(firstSendCount)
    expect(
      sendMock.mock.calls.some((call) => (call[0] as { userId: string }).userId === 'user-only-all'),
    ).toBe(true)
  })

  it('returns zero without side effects when there is no audience', async () => {
    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-missing-not-found',
      discountFingerprint: 'rule-missing-not-found:2026-07-01T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    expect(result).toEqual({ notified: 0 })
    expect(prisma.campaignEmailDispatch.create).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
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
