import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'

const { enqueueProductSyncMock, enqueueCategorySyncMock } = vi.hoisted(() => ({
  enqueueProductSyncMock: vi.fn(),
  enqueueCategorySyncMock: vi.fn(),
}))

vi.mock('../../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: enqueueProductSyncMock,
  enqueueCategorySync: enqueueCategorySyncMock,
}))

import { createCatalogService } from '../../../api/services/catalog.service'

describe('catalog.service product creation', () => {
  beforeEach(() => {
    enqueueProductSyncMock.mockReset()
    enqueueCategorySyncMock.mockReset()
    enqueueProductSyncMock.mockResolvedValue(undefined)
    enqueueCategorySyncMock.mockResolvedValue(undefined)
  })

  it('creates a unique slug when another product already uses the same name', async () => {
    const productCreateMock = vi.fn().mockResolvedValue({
      id: 'prod-2',
      status: 'pending_review',
      publishedAt: null,
    })

    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({ id: 'seller-1', status: 'active' }),
      },
      category: {
        findUnique: vi.fn().mockResolvedValue({ id: 'cat-1', slug: 'mobilya' }),
      },
      product: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'prod-1', slug: 'ayni-isimli-urun' })
          .mockResolvedValueOnce(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: productCreateMock,
        update: vi.fn(),
      },
    } as never

    const service = createCatalogService({ prisma })
    await service.createProduct({
      sellerId: 'seller-1',
      categoryId: 'cat-1',
      name: 'Ayni Isimli Urun',
      description: 'Bu urun aciklamasi test icin yeterince uzundur.',
      price: new Decimal(1200),
      stockQuantity: 4,
      barcode: '8691234567890',
      sku: 'SKU-01',
    })

    expect(productCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'ayni-isimli-urun-2',
          sku: 'SKU-01',
        }),
      }),
    )
  })

  it('keeps accepting sku values without treating them as unique identifiers', async () => {
    const barcodeLookupMock = vi.fn().mockResolvedValue(null)
    const productCreateMock = vi.fn().mockResolvedValue({
      id: 'prod-3',
      status: 'pending_review',
      publishedAt: null,
    })

    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({ id: 'seller-1', status: 'active' }),
      },
      category: {
        findUnique: vi.fn().mockResolvedValue({ id: 'cat-1', slug: 'mobilya' }),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: barcodeLookupMock,
        create: productCreateMock,
        update: vi.fn(),
      },
    } as never

    const service = createCatalogService({ prisma })
    await service.createProduct({
      sellerId: 'seller-1',
      categoryId: 'cat-1',
      name: 'SKU Tekrarli Urun',
      description: 'Bu urun aciklamasi test icin yeterince uzundur.',
      price: new Decimal(950),
      stockQuantity: 2,
      barcode: '8691234567891',
      sku: 'SKU-TEKRAR',
    })

    expect(barcodeLookupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barcode: '8691234567891',
        }),
      }),
    )
    expect(productCreateMock).toHaveBeenCalledOnce()
  })
})
