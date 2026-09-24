/**
 * Product page ↔ cart price consistency for variant products (e-mail plan phase 6).
 *
 * The product page used to show the raw variant price while the cart charged the discounted
 * one. Both now use applyEffectivePricing (api/domain/effective-price.ts). These tests compare
 * getProductBySlug's variant prices with the cart's unit prices for the same data, across rule
 * start/end, overlapping rules and variant changes.
 */
import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'

vi.mock('../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: vi.fn(),
  enqueueCategorySync: vi.fn(),
}))

import { createCatalogService } from '../../api/services/catalog.service'
import { createCartService } from '../../api/services/cart.service'

const START = new Date('2026-10-01T10:00:00.000Z')
const END = new Date('2026-10-01T12:00:00.000Z')

function rule(overrides: Record<string, unknown>) {
  return {
    id: 'rule',
    name: 'Kampanya',
    sellerId: 'seller-1',
    scope: 'ALL_PRODUCTS',
    type: 'PERCENT',
    value: new Decimal(10),
    categoryId: null,
    status: 'ACTIVE',
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    products: [] as Array<{ productId: string }>,
    ...overrides,
  }
}

function productRow() {
  return {
    id: 'prod-1',
    slug: 'mese-sehpa',
    name: 'Meşe Sehpa',
    sellerId: 'seller-1',
    categoryId: 'cat-1',
    status: 'published',
    price: new Decimal(1000),
    compareAtPrice: null,
    stockQuantity: 5,
    seller: { id: 'seller-1', status: 'active', vacationModeEnabled: false, displayName: 'Atölye', slug: 'atolye' },
    images: [],
    category: null,
    attributeValues: [],
    variants: [
      { id: 'var-own', name: 'Ceviz', price: new Decimal(1249.99), stockQuantity: 2 },
      { id: 'var-inherit', name: 'Doğal', price: null, stockQuantity: 3 },
    ],
  }
}

const SETTINGS = {
  id: 'default',
  standardPenaltyRate: new Decimal(0.2),
  dailyPenaltyRate: new Decimal(0.01),
  defaultSellerCommissionRate: new Decimal(0.15),
  fulfillmentDays: 20,
  fulfillmentWarningDays: 5,
  payoutHoldDays: 30,
  freeShippingThresholdTry: new Decimal(500),
  flatShippingFeeTry: new Decimal(49.9),
  defaultTaxRate: new Decimal(0.2),
  commissionVatRate: new Decimal(0.2),
  eftDiscountRate: new Decimal(0),
  updatedBy: null,
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
}

function prismaFor(rules: Array<ReturnType<typeof rule>>, cartVariantId: string) {
  const product = productRow()
  return {
    product: {
      findUnique: vi.fn(async () => product),
      findMany: vi.fn(async () => [product]),
    },
    discountRule: { findMany: vi.fn(async () => rules) },
    category: { findMany: vi.fn(async () => [{ id: 'cat-1', parentId: null, taxRate: new Decimal(0.2) }]) },
    platformSettings: { upsert: vi.fn(async () => SETTINGS) },
    cart: {
      findUnique: vi.fn(async () => ({
        id: 'cart-1',
        userId: 'user-1',
        couponCode: null,
        items: [
          {
            id: 'item-1',
            cartId: 'cart-1',
            productId: 'prod-1',
            variantId: cartVariantId,
            quantity: 1,
            unitPrice: new Decimal(1),
          },
        ],
      })),
      findFirst: vi.fn(async () => null),
    },
  }
}

async function pagePrices(rules: Array<ReturnType<typeof rule>>, now: Date) {
  vi.setSystemTime(now)
  const catalog = createCatalogService({ prisma: prismaFor(rules, 'var-own') as never })
  const product = await catalog.getProductBySlug('mese-sehpa')
  return Object.fromEntries(
    (product.variants as Array<{ id: string; price: Decimal; compareAtPrice: Decimal | null }>).map((variant) => [
      variant.id,
      { price: variant.price.toString(), compareAtPrice: variant.compareAtPrice?.toString() ?? null },
    ]),
  )
}

async function cartUnitPrice(rules: Array<ReturnType<typeof rule>>, now: Date, variantId: string) {
  vi.setSystemTime(now)
  const cart = createCartService({ prisma: prismaFor(rules, variantId) as never })
  const summary = await cart.getCart({ userId: 'user-1' } as never)
  return (summary as { items: Array<{ unitPrice: Decimal }> }).items[0]!.unitPrice.toString()
}

const scenarios: Array<[string, Array<ReturnType<typeof rule>>, Date]> = [
  ['no rule', [], new Date('2026-10-01T11:00:00.000Z')],
  ['store-wide 10% rule', [rule({})], new Date('2026-10-01T11:00:00.000Z')],
  [
    'PRODUCT rule overlapping CATEGORY and ALL_PRODUCTS rules (PRODUCT wins)',
    [
      rule({ id: 'all', value: new Decimal(40) }),
      rule({ id: 'cat', scope: 'CATEGORY', categoryId: 'cat-1', value: new Decimal(25) }),
      rule({ id: 'prod', scope: 'PRODUCT', type: 'FIXED_AMOUNT', value: new Decimal(100), products: [{ productId: 'prod-1' }] }),
    ],
    new Date('2026-10-01T11:00:00.000Z'),
  ],
  ['scheduled rule before it starts', [rule({ status: 'SCHEDULED', startsAt: START, endsAt: END })], new Date(START.getTime() - 1)],
  ['scheduled rule at its start', [rule({ status: 'SCHEDULED', startsAt: START, endsAt: END })], START],
  ['rule at its last instant', [rule({ startsAt: START, endsAt: END })], END],
  ['rule just after it ended', [rule({ startsAt: START, endsAt: END })], new Date(END.getTime() + 1)],
]

describe('product page variant price = cart unit price', () => {
  it.each(scenarios)('%s', async (_name, rules, now) => {
    vi.useFakeTimers()
    try {
      const page = await pagePrices(rules, now)
      for (const variantId of ['var-own', 'var-inherit']) {
        expect(page[variantId]!.price).toBe(await cartUnitPrice(rules, now, variantId))
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('strikes a discounted variant through at its own base price, and not at all without a rule', async () => {
    vi.useFakeTimers()
    try {
      const discounted = await pagePrices([rule({})], new Date('2026-10-01T11:00:00.000Z'))
      expect(discounted['var-own']).toEqual({ price: '1124.99', compareAtPrice: '1249.99' })
      expect(discounted['var-inherit']).toEqual({ price: '900', compareAtPrice: '1000' })

      const plain = await pagePrices([], new Date('2026-10-01T11:00:00.000Z'))
      expect(plain['var-own']).toEqual({ price: '1249.99', compareAtPrice: null })
    } finally {
      vi.useRealTimers()
    }
  })
})
