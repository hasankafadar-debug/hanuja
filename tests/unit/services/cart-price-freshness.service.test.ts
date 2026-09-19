/**
 * Guards for the storefront showcase cache (apps/web/src/lib/homepage-showcase-data.ts):
 * a homepage card may be up to ~60 s stale, so the cart must always re-derive price
 * and availability from the database, never from the card or the cart snapshot.
 */
import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import { createCartService } from '../../../api/services/cart.service'
import {
  NotFoundError,
  SellerOnVacationError,
  SellerSuspendedError,
} from '../../../api/lib/errors'

const SETTINGS_ROW = {
  standardPenaltyRate: new Decimal(0.2),
  dailyPenaltyRate: new Decimal(0.01),
  defaultSellerCommissionRate: new Decimal(0.15),
  fulfillmentDays: 20,
  fulfillmentWarningDays: 15,
  payoutHoldDays: 30,
  freeShippingThresholdTry: new Decimal(1500),
  flatShippingFeeTry: new Decimal(99),
  defaultTaxRate: new Decimal(0.2),
  commissionVatRate: new Decimal(0.2),
  eftDiscountRate: new Decimal(0),
  updatedBy: null,
  updatedAt: new Date('2026-09-01'),
}

function catalogProduct(overrides: Partial<{
  price: Decimal
  status: string
  stockQuantity: number
  seller: { status: string; vacationModeEnabled: boolean }
}> = {}) {
  return {
    id: 'p1',
    name: 'Meşe Sehpa',
    slug: 'mese-sehpa',
    sellerId: 'seller-1',
    categoryId: 'cat-1',
    status: 'published',
    stockQuantity: 10,
    price: new Decimal(249),
    compareAtPrice: null,
    variants: [],
    images: [],
    seller: { id: 'seller-1', displayName: 'Atelier', slug: 'atelier', status: 'active', vacationModeEnabled: false },
    ...overrides,
  }
}

function buildPrisma(options: {
  product?: ReturnType<typeof catalogProduct>
  discountRules?: unknown[]
  cartItems?: Array<{ id: string; productId: string; variantId: string | null; quantity: number; unitPrice: Decimal }>
} = {}) {
  const product = options.product ?? catalogProduct()
  const cartItemUpsert = vi.fn().mockImplementation(async (args: { create: { unitPrice: Decimal; quantity: number } }) => ({
    id: 'item-1',
    ...args.create,
  }))

  return {
    platformSettings: { upsert: vi.fn().mockResolvedValue(SETTINGS_ROW) },
    cart: {
      findUnique: vi.fn().mockResolvedValue(
        options.cartItems
          ? { id: 'cart-1', userId: 'u1', couponCode: null, items: options.cartItems }
          : null,
      ),
      upsert: vi.fn().mockResolvedValue({ id: 'cart-1', userId: 'u1', couponCode: null, items: [] }),
    },
    cartItem: { upsert: cartItemUpsert },
    product: {
      findMany: vi.fn().mockResolvedValue([product]),
      findUnique: vi.fn().mockResolvedValue(product),
    },
    category: { findMany: vi.fn().mockResolvedValue([]) },
    discountRule: { findMany: vi.fn().mockResolvedValue(options.discountRules ?? []) },
    // product analytics: non-customer role short-circuits the event write
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'seller' }) },
  }
}

describe('cart.service — price and availability are re-derived from the database', () => {
  it('getCart prices an existing line from the current product price, not the cart snapshot', async () => {
    const prisma = buildPrisma({
      product: catalogProduct({ price: new Decimal(249) }),
      cartItems: [{ id: 'item-1', productId: 'p1', variantId: null, quantity: 2, unitPrice: new Decimal(199) }],
    })
    const service = createCartService({ prisma: prisma as never })

    const cart = await service.getCart('u1')

    expect(cart.items[0]?.unitPrice.toNumber()).toBe(249)
    expect(cart.subtotal.toNumber()).toBe(498)
  })

  it('getCart drops an ended campaign price and returns to the base price', async () => {
    const endedRule = {
      id: 'rule-1',
      sellerId: 'seller-1',
      name: 'Bahar',
      scope: 'ALL_PRODUCTS',
      type: 'PERCENT',
      value: new Decimal(20),
      status: 'ACTIVE',
      startsAt: new Date('2026-08-01'),
      endsAt: new Date('2026-08-31'),
      createdAt: new Date('2026-08-01'),
      categoryId: null,
      products: [],
    }
    const prisma = buildPrisma({
      product: catalogProduct({ price: new Decimal(100) }),
      discountRules: [endedRule],
      cartItems: [{ id: 'item-1', productId: 'p1', variantId: null, quantity: 1, unitPrice: new Decimal(80) }],
    })
    const service = createCartService({ prisma: prisma as never })

    const cart = await service.getCart('u1')

    expect(cart.items[0]?.unitPrice.toNumber()).toBe(100)
  })

  it('addItem stores the database price; the caller cannot supply one', async () => {
    const prisma = buildPrisma({ product: catalogProduct({ price: new Decimal(249) }) })
    const service = createCartService({ prisma: prisma as never })

    await service.addItem({ userId: 'u1', productId: 'p1', quantity: 1 })

    const upsertArgs = prisma.cartItem.upsert.mock.calls[0]?.[0] as { create: { unitPrice: Decimal } }
    expect(upsertArgs.create.unitPrice.toNumber()).toBe(249)
  })

  it('addItem rejects a product that is no longer published', async () => {
    const prisma = buildPrisma({ product: catalogProduct({ status: 'unlisted' }) })
    const service = createCartService({ prisma: prisma as never })

    await expect(service.addItem({ userId: 'u1', productId: 'p1', quantity: 1 })).rejects.toBeInstanceOf(NotFoundError)
    expect(prisma.cartItem.upsert).not.toHaveBeenCalled()
  })

  it('addItem rejects a suspended seller and a seller in Tatil Modu', async () => {
    const suspended = createCartService({
      prisma: buildPrisma({
        product: catalogProduct({ seller: { status: 'suspended', vacationModeEnabled: false } }),
      }) as never,
    })
    await expect(suspended.addItem({ userId: 'u1', productId: 'p1', quantity: 1 })).rejects.toBeInstanceOf(
      SellerSuspendedError,
    )

    const onVacation = createCartService({
      prisma: buildPrisma({
        product: catalogProduct({ seller: { status: 'active', vacationModeEnabled: true } }),
      }) as never,
    })
    await expect(onVacation.addItem({ userId: 'u1', productId: 'p1', quantity: 1 })).rejects.toBeInstanceOf(
      SellerOnVacationError,
    )
  })
})
