import { describe, expect, it, vi } from 'vitest'
import { listAdminMedia } from '../../../api/services/admin-media.service'
import { createMediaService } from '../../../api/services/media.service'

function mediaAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    kind: 'image',
    url: 'https://cdn.example/products/seller-user-1/product.jpg',
    folder: 'products',
    originalName: 'product.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1200,
    width: 1200,
    height: 800,
    durationSec: null,
    variants: null,
    status: 'ready',
    createdAt: new Date('2026-07-29T10:00:00.000Z'),
    ...overrides,
  }
}

describe('admin media library scoping', () => {
  it('lists only ready assets owned by the current admin', async () => {
    const findMany = vi.fn().mockResolvedValue([mediaAsset({ folder: 'general' })])
    const count = vi.fn().mockResolvedValue(1)
    const prisma = {
      mediaAsset: { findMany, count },
    }

    const result = await listAdminMedia(prisma as never, 'admin-user-1', {
      source: 'admin',
      page: 1,
      pageSize: 20,
      kind: 'image',
      folder: 'general',
      search: 'banner',
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uploadedBy: 'admin-user-1',
          status: 'ready',
          kind: 'image',
          folder: 'general',
          originalName: { contains: 'banner', mode: 'insensitive' },
        },
      }),
    )
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        uploadedBy: 'admin-user-1',
        status: 'ready',
      }),
    })
    expect(result.assets).toEqual([expect.objectContaining({ id: 'asset-1', source: 'admin' })])
  })

  it('returns only published product images owned by that product seller', async () => {
    const productImageFindMany = vi.fn().mockResolvedValue([
      {
        url: 'https://cdn.example/products/seller-user-1/product.jpg',
        product: {
          id: 'product-1',
          name: 'El Yapımı Çanta',
          modelCode: 'CANTA-001',
          seller: {
            id: 'seller-1',
            userId: 'seller-user-1',
            displayName: 'Usta Atölye',
          },
        },
      },
    ])
    const mediaFindMany = vi
      .fn()
      .mockResolvedValue([
        mediaAsset({ id: 'owned', uploadedBy: 'seller-user-1' }),
        mediaAsset({ id: 'wrong-owner', uploadedBy: 'seller-user-2' }),
      ])
    const prisma = {
      productImage: { findMany: productImageFindMany },
      mediaAsset: { findMany: mediaFindMany },
    }

    const result = await listAdminMedia(prisma as never, 'admin-user-1', {
      source: 'seller-products',
      page: 1,
      pageSize: 20,
      search: 'usta',
    })

    expect(productImageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { product: { status: 'published' } },
      }),
    )
    expect(mediaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          url: {
            in: ['https://cdn.example/products/seller-user-1/product.jpg'],
          },
          folder: 'products',
          kind: 'image',
          status: 'ready',
        },
      }),
    )
    expect(result.total).toBe(1)
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: 'owned',
        source: 'seller-products',
        product: {
          id: 'product-1',
          name: 'El Yapımı Çanta',
          modelCode: 'CANTA-001',
        },
        seller: { id: 'seller-1', displayName: 'Usta Atölye' },
      }),
    ])
  })

  it('keeps seller media queries isolated to the requesting seller', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([mediaAsset({ id: 'seller-1-asset', uploadedBy: 'seller-user-1' })])
      .mockResolvedValueOnce([mediaAsset({ id: 'seller-2-asset', uploadedBy: 'seller-user-2' })])
    const count = vi.fn().mockResolvedValue(1)
    const transaction = vi
      .fn()
      .mockResolvedValueOnce([
        [mediaAsset({ id: 'seller-1-asset', uploadedBy: 'seller-user-1' })],
        1,
      ])
      .mockResolvedValueOnce([
        [mediaAsset({ id: 'seller-2-asset', uploadedBy: 'seller-user-2' })],
        1,
      ])
    const prisma = {
      mediaAsset: { findMany, count },
      $transaction: transaction,
    }
    const service = createMediaService({ prisma: prisma as never })

    await service.listAssets('seller-user-1', 'products')
    await service.listAssets('seller-user-2', 'products')

    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      uploadedBy: 'seller-user-1',
      folder: 'products',
      status: 'ready',
    })
    expect(findMany.mock.calls[1]?.[0].where).toEqual({
      uploadedBy: 'seller-user-2',
      folder: 'products',
      status: 'ready',
    })
  })
})
