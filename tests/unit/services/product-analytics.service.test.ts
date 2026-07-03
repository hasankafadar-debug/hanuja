import { describe, expect, it, vi } from 'vitest'
import { createProductAnalyticsService } from '../../../api/services/product-analytics.service'

const range = {
  from: new Date('2026-05-18T00:00:00.000Z'),
  to: new Date('2026-06-17T23:59:59.999Z'),
}

function product(id: string, name = id) {
  return {
    id,
    name,
    slug: `${id}-slug`,
    images: [],
  }
}

function buildPrismaMock(params: {
  products?: Array<ReturnType<typeof product>>
  events?: Array<{ productId: string; userId: string; eventType: string }>
  favorites?: Array<{ productId: string; userId: string }>
  cartItems?: Array<{ productId: string; cart: { userId: string | null } }>
  orderLines?: Array<{ productId: string; order: { customerId: string } }>
}) {
  return {
    product: {
      findMany: vi.fn().mockResolvedValue(params.products ?? [product('product-1')]),
    },
    productAnalyticsEvent: {
      findMany: vi.fn().mockResolvedValue(params.events ?? []),
    },
    favoriteProduct: {
      findMany: vi.fn().mockResolvedValue(params.favorites ?? []),
    },
    cartItem: {
      findMany: vi.fn().mockResolvedValue(params.cartItems ?? []),
    },
    orderLine: {
      findMany: vi.fn().mockResolvedValue(params.orderLines ?? []),
    },
  }
}

describe('ProductAnalyticsService seller report', () => {
  it('queries products for the requested seller only', async () => {
    const prisma = buildPrismaMock({ products: [product('seller-product')] })
    const service = createProductAnalyticsService({ prisma: prisma as never })

    const report = await service.getSellerProductReport({
      sellerId: 'seller-1',
      ...range,
    })

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: 'seller-1' },
      }),
    )
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]?.productId).toBe('seller-product')
  })

  it('counts the same customer once across repeated views in the range', async () => {
    const prisma = buildPrismaMock({
      products: [product('product-1')],
      events: [
        { productId: 'product-1', userId: 'customer-1', eventType: 'product_view' },
        { productId: 'product-1', userId: 'customer-1', eventType: 'product_view' },
      ],
    })
    const service = createProductAnalyticsService({ prisma: prisma as never })

    const report = await service.getSellerProductReport({
      sellerId: 'seller-1',
      ...range,
    })

    expect(report.rows[0]?.viewedCustomerCount).toBe(1)
  })

  it('deduplicates favorite and cart customers across event and live sources', async () => {
    const prisma = buildPrismaMock({
      products: [product('product-1')],
      events: [
        { productId: 'product-1', userId: 'customer-1', eventType: 'favorite_add' },
        { productId: 'product-1', userId: 'customer-3', eventType: 'cart_add' },
      ],
      favorites: [
        { productId: 'product-1', userId: 'customer-1' },
        { productId: 'product-1', userId: 'customer-2' },
      ],
      cartItems: [
        { productId: 'product-1', cart: { userId: 'customer-3' } },
        { productId: 'product-1', cart: { userId: 'customer-4' } },
      ],
    })
    const service = createProductAnalyticsService({ prisma: prisma as never })

    const report = await service.getSellerProductReport({
      sellerId: 'seller-1',
      ...range,
    })

    expect(report.rows[0]?.favoritedCustomerCount).toBe(2)
    expect(report.rows[0]?.cartCustomerCount).toBe(2)
  })

  it('does not calculate a conversion percentage when views are zero', async () => {
    const prisma = buildPrismaMock({
      products: [product('product-1')],
      orderLines: [
        { productId: 'product-1', order: { customerId: 'customer-1' } },
      ],
    })
    const service = createProductAnalyticsService({ prisma: prisma as never })

    const report = await service.getSellerProductReport({
      sellerId: 'seller-1',
      ...range,
    })

    expect(report.rows[0]?.convertedCustomerCount).toBe(1)
    expect(report.rows[0]?.conversionRate).toBeNull()
  })
})
