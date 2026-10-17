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
        // findById() always includes children; the leaf-category rule reads them.
        findUnique: vi.fn().mockResolvedValue({
          id: 'cat-1',
          slug: 'mobilya',
          children: [],
          templateCode: 'EV-MOBILYA',
        }),
      },
      catalogTemplate: {
        findUnique: vi.fn().mockResolvedValue({
          code: 'EV-MOBILYA',
          compatibilityVersion: 1,
          config: {
            fields: [],
            requiredGroups: [],
            variantKey: null,
            variantLabel: null,
            contentKeys: [],
            shared: { color: true, material: true, dimensions: true },
            materialLabels: [],
          },
        }),
      },
      catalogField: { findMany: vi.fn().mockResolvedValue([]) },
      product: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'prod-1', slug: 'test-brand-ayni-isimli-urun' })
          .mockResolvedValueOnce(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: productCreateMock,
        update: vi.fn(),
      },
      barcodeRegistry: {
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
    } as never

    const service = createCatalogService({ prisma })
    await service.createProduct({
      brand: 'Test Brand',
      sellerId: 'seller-1',
      categoryId: 'cat-1',
      name: 'Ayni Isimli Urun',
      description: 'Bu urun aciklamasi test icin yeterince uzundur.',
      price: new Decimal(1200),
      fulfillmentDays: 5,
      stockQuantity: 4,
      barcode: '8691234567890',
      sku: 'SKU-01',
      modelCode: 'MODEL-01',
    })

    expect(productCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'test-brand-ayni-isimli-urun-2',
          sku: 'SKU-01',
          modelCode: 'MODEL-01',
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
        // findById() always includes children; the leaf-category rule reads them.
        findUnique: vi.fn().mockResolvedValue({
          id: 'cat-1',
          slug: 'mobilya',
          children: [],
          templateCode: 'EV-MOBILYA',
        }),
      },
      catalogTemplate: {
        findUnique: vi.fn().mockResolvedValue({
          code: 'EV-MOBILYA',
          compatibilityVersion: 1,
          config: {
            fields: [],
            requiredGroups: [],
            variantKey: null,
            variantLabel: null,
            contentKeys: [],
            shared: { color: true, material: true, dimensions: true },
            materialLabels: [],
          },
        }),
      },
      catalogField: { findMany: vi.fn().mockResolvedValue([]) },
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: productCreateMock,
        update: vi.fn(),
      },
      barcodeRegistry: { findFirst: barcodeLookupMock, deleteMany: vi.fn(), create: vi.fn() },
    } as never

    const service = createCatalogService({ prisma })
    await service.createProduct({
      brand: 'Test Brand',
      sellerId: 'seller-1',
      categoryId: 'cat-1',
      name: 'SKU Tekrarli Urun',
      description: 'Bu urun aciklamasi test icin yeterince uzundur.',
      price: new Decimal(950),
      fulfillmentDays: 3,
      stockQuantity: 2,
      barcode: '8691234567891',
      sku: 'SKU-TEKRAR',
      modelCode: 'MODEL-TEKRAR',
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

  it('does not expose a published product owned by a suspended seller', async () => {
    const prisma = {
      catalogTemplate: {
        findUnique: vi.fn().mockResolvedValue({
          code: 'EV-MOBILYA',
          compatibilityVersion: 1,
          config: {
            fields: [],
            requiredGroups: [],
            variantKey: null,
            variantLabel: null,
            contentKeys: [],
            shared: { color: true, material: true, dimensions: true },
            materialLabels: [],
          },
        }),
      },
      catalogField: { findMany: vi.fn().mockResolvedValue([]) },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'prod-suspended',
          slug: 'askidaki-urun',
          status: 'published',
          seller: { id: 'seller-1', status: 'suspended' },
          images: [],
          variants: [],
          category: null,
          attributeValues: [],
        }),
      },
    } as never

    const service = createCatalogService({ prisma })
    await expect(service.getProductBySlug('askidaki-urun')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  // A homepage card can be up to ~60 s stale (showcase data cache); the product
  // page must still hide what is no longer sellable at click time.
  it('does not expose a product that is no longer published', async () => {
    const prisma = {
      catalogTemplate: {
        findUnique: vi.fn().mockResolvedValue({
          code: 'EV-MOBILYA',
          compatibilityVersion: 1,
          config: {
            fields: [],
            requiredGroups: [],
            variantKey: null,
            variantLabel: null,
            contentKeys: [],
            shared: { color: true, material: true, dimensions: true },
            materialLabels: [],
          },
        }),
      },
      catalogField: { findMany: vi.fn().mockResolvedValue([]) },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'prod-unlisted',
          slug: 'yayindan-kalkan-urun',
          status: 'unlisted',
          seller: { id: 'seller-1', status: 'active', vacationModeEnabled: false },
          images: [],
          variants: [],
          category: null,
          attributeValues: [],
        }),
      },
    } as never

    const service = createCatalogService({ prisma })
    await expect(service.getProductBySlug('yayindan-kalkan-urun')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('does not expose a published product whose seller is in Tatil Modu', async () => {
    const prisma = {
      catalogTemplate: {
        findUnique: vi.fn().mockResolvedValue({
          code: 'EV-MOBILYA',
          compatibilityVersion: 1,
          config: {
            fields: [],
            requiredGroups: [],
            variantKey: null,
            variantLabel: null,
            contentKeys: [],
            shared: { color: true, material: true, dimensions: true },
            materialLabels: [],
          },
        }),
      },
      catalogField: { findMany: vi.fn().mockResolvedValue([]) },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'prod-vacation',
          slug: 'tatildeki-satici-urunu',
          status: 'published',
          seller: { id: 'seller-1', status: 'active', vacationModeEnabled: true },
          images: [],
          variants: [],
          category: null,
          attributeValues: [],
        }),
      },
    } as never

    const service = createCatalogService({ prisma })
    await expect(service.getProductBySlug('tatildeki-satici-urunu')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})


describe('catalog.service product brand updates', () => {
  function fixture() {
    const product = {
      id: 'prod-brand', sellerId: 'seller-1', slug: 'antico',
      name: 'Mosaiss Home Antico', brand: 'Mosaiss Home', categoryId: null,
      price: new Decimal(1200), compareAtPrice: null, barcode: null,
      status: 'published', publishedAt: new Date(), variants: [],
    }
    const update = vi.fn().mockImplementation(async ({ data }) => ({ ...product, ...data }))
    const service = createCatalogService({ prisma: {
      seller: { findUnique: vi.fn().mockResolvedValue({ id: 'seller-1' }) },
      product: { findFirst: vi.fn().mockResolvedValue(product), update },
    } as never })
    return { service, update }
  }

  it.each([{ price: new Decimal(1400) }, { stockQuantity: 7 }])(
    'preserves brand, title and slug on partial price/stock updates: %j',
    async (patch) => {
      const { service, update } = fixture()
      await service.updateProductForSeller({ productId: 'prod-brand', sellerId: 'seller-1', ...patch })
      const data = update.mock.calls[0]![0].data
      expect(data).toMatchObject(patch)
      for (const field of ['brand', 'name', 'slug']) expect(data).not.toHaveProperty(field)
    },
  )

  it('replaces an overlapping old brand without changing the existing URL', async () => {
    const { service, update } = fixture()
    await service.updateProductForSeller({
      productId: 'prod-brand', sellerId: 'seller-1', brand: ' Mosaiss ', deferVisibilitySync: true,
    })
    const data = update.mock.calls[0]![0].data
    expect(data).toMatchObject({ brand: 'Mosaiss', name: 'Mosaiss Antico' })
    expect(data).not.toHaveProperty('slug')
  })

  it('rejects a blank replacement brand before updating the product', async () => {
    const { service, update } = fixture()
    await expect(service.updateProductForSeller({
      productId: 'prod-brand', sellerId: 'seller-1', brand: ' ',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(update).not.toHaveBeenCalled()
  })
})
