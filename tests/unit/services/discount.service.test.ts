import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { createDiscountService } from '~/api/services/discount.service'

describe('discount service', () => {
  it('prefers product rules over broader scopes', async () => {
    const prisma = {
      discountRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rule-all',
            sellerId: 'seller-1',
            name: 'Tüm Ürünler %10',
            scope: 'ALL_PRODUCTS',
            type: 'PERCENT',
            value: new Decimal(10),
            categoryId: null,
            status: 'ACTIVE',
            startsAt: null,
            endsAt: null,
            products: [],
          },
          {
            id: 'rule-category',
            sellerId: 'seller-1',
            name: 'Kategori %15',
            scope: 'CATEGORY',
            type: 'PERCENT',
            value: new Decimal(15),
            categoryId: 'category-1',
            status: 'ACTIVE',
            startsAt: null,
            endsAt: null,
            products: [],
          },
          {
            id: 'rule-product',
            sellerId: 'seller-1',
            name: 'Ürün %5',
            scope: 'PRODUCT',
            type: 'PERCENT',
            value: new Decimal(5),
            categoryId: null,
            status: 'ACTIVE',
            startsAt: null,
            endsAt: null,
            products: [{ productId: 'product-1' }],
          },
        ]),
      },
    } as never

    const service = createDiscountService({ prisma })
    const pricing = await service.resolveEffectivePrice(
      {
        id: 'product-1',
        sellerId: 'seller-1',
        categoryId: 'category-1',
        price: new Decimal(1000),
        compareAtPrice: null,
      },
      'seller-1',
      new Date('2026-04-20T12:00:00.000Z'),
    )

    expect(pricing.effectivePrice.toNumber()).toBe(950)
    expect(pricing.discountSource?.ruleId).toBe('rule-product')
  })

  it('chooses the best rule within the same scope', async () => {
    const prisma = {
      discountRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rule-category-1',
            sellerId: 'seller-1',
            name: 'Kategori %10',
            scope: 'CATEGORY',
            type: 'PERCENT',
            value: new Decimal(10),
            categoryId: 'category-1',
            status: 'ACTIVE',
            startsAt: null,
            endsAt: null,
            products: [],
          },
          {
            id: 'rule-category-2',
            sellerId: 'seller-1',
            name: 'Kategori 150 TL',
            scope: 'CATEGORY',
            type: 'FIXED_AMOUNT',
            value: new Decimal(150),
            categoryId: 'category-1',
            status: 'ACTIVE',
            startsAt: null,
            endsAt: null,
            products: [],
          },
        ]),
      },
    } as never

    const service = createDiscountService({ prisma })
    const pricing = await service.resolveEffectivePrice(
      {
        id: 'product-2',
        sellerId: 'seller-1',
        categoryId: 'category-1',
        price: new Decimal(1000),
        compareAtPrice: null,
      },
      'seller-1',
      new Date('2026-04-20T12:00:00.000Z'),
    )

    expect(pricing.effectivePrice.toNumber()).toBe(850)
    expect(pricing.discountSource?.ruleId).toBe('rule-category-2')
  })
})
