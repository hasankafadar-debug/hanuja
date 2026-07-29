import { describe, expect, it, vi } from 'vitest'
import { createHomeCmsService } from '../../../api/services/home-cms.service'

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    kind: 'image',
    url: 'https://cdn.example/general/admin.jpg',
    folder: 'general',
    status: 'ready',
    uploadedBy: 'admin-user-1',
    ...overrides,
  }
}

function existingSlide(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slide-1',
    mediaAssetId: 'legacy-seller-image',
    posterAssetId: null,
    eyebrow: null,
    title: 'Eski slayt',
    body: null,
    ctaLabel: 'Keşfet',
    ctaHref: '/',
    startsAt: null,
    endsAt: null,
    sellerId: null,
    sortOrder: 0,
    isActive: true,
    createdBy: 'admin-user-1',
    mediaAsset: {
      id: 'legacy-seller-image',
      kind: 'image',
      url: 'https://cdn.example/products/legacy.jpg',
      variants: null,
      durationSec: null,
      width: 1200,
      height: 800,
      originalName: 'legacy.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
    },
    posterAsset: null,
    seller: null,
    ...overrides,
  }
}

function createPrismaMock() {
  const prisma = {
    mediaAsset: {
      findUnique: vi.fn(),
    },
    productImage: {
      findFirst: vi.fn(),
    },
    homeSlide: {
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({
        id: 'slide-new',
        title: 'Yeni slayt',
        mediaAssetId: 'asset-1',
        sortOrder: 0,
      }),
      update: vi.fn().mockResolvedValue({
        id: 'slide-1',
        title: 'Güncel slayt',
        isActive: true,
        sortOrder: 0,
      }),
    },
    homePromo: {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({
        id: 'promo-1',
        title: 'Promo',
        isActive: true,
      }),
    },
    adminAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }

  return prisma
}

const createSlideInput = {
  mediaAssetId: 'asset-1',
  title: 'Yeni slayt',
  ctaLabel: 'Keşfet',
  ctaHref: '/',
  actorId: 'admin-user-1',
}

describe('home CMS media eligibility', () => {
  it('accepts a ready CMS image owned by the current admin', async () => {
    const prisma = createPrismaMock()
    prisma.mediaAsset.findUnique.mockResolvedValue(asset())
    const service = createHomeCmsService({ prisma: prisma as never })

    await expect(service.createSlide(createSlideInput)).resolves.toMatchObject({
      id: 'slide-new',
    })
    expect(prisma.productImage.findFirst).not.toHaveBeenCalled()
  })

  it('accepts an image attached to a published product owned by its seller', async () => {
    const prisma = createPrismaMock()
    prisma.mediaAsset.findUnique.mockResolvedValue(
      asset({
        folder: 'products',
        uploadedBy: 'seller-user-1',
        url: 'https://cdn.example/products/seller-user-1/product.jpg',
      }),
    )
    prisma.productImage.findFirst.mockResolvedValue({ id: 'product-image-1' })
    const service = createHomeCmsService({ prisma: prisma as never })

    await expect(service.createSlide(createSlideInput)).resolves.toMatchObject({
      id: 'slide-new',
    })
    expect(prisma.productImage.findFirst).toHaveBeenCalledWith({
      where: {
        url: 'https://cdn.example/products/seller-user-1/product.jpg',
        product: {
          status: 'published',
          seller: { userId: 'seller-user-1' },
        },
      },
      select: { id: true },
    })
  })

  it('rejects arbitrary seller media and unpublished product images', async () => {
    const prisma = createPrismaMock()
    prisma.mediaAsset.findUnique.mockResolvedValue(
      asset({
        folder: 'products',
        uploadedBy: 'seller-user-1',
      }),
    )
    prisma.productImage.findFirst.mockResolvedValue(null)
    const service = createHomeCmsService({ prisma: prisma as never })

    await expect(service.createSlide(createSlideInput)).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    })
    expect(prisma.homeSlide.create).not.toHaveBeenCalled()
  })

  it('requires a valid image poster for admin videos', async () => {
    const prisma = createPrismaMock()
    prisma.mediaAsset.findUnique.mockResolvedValue(
      asset({
        kind: 'video',
        folder: 'slider',
        url: 'https://cdn.example/slider/admin.mp4',
      }),
    )
    const service = createHomeCmsService({ prisma: prisma as never })

    await expect(service.createSlide(createSlideInput)).rejects.toThrow(
      'Video slaytlarda poster görseli zorunludur.',
    )
  })

  it('rejects videos in promo slots', async () => {
    const prisma = createPrismaMock()
    prisma.homePromo.findUnique.mockResolvedValue(null)
    prisma.mediaAsset.findUnique.mockResolvedValue(
      asset({
        kind: 'video',
        folder: 'slider',
        url: 'https://cdn.example/slider/admin.mp4',
      }),
    )
    const service = createHomeCmsService({ prisma: prisma as never })

    await expect(
      service.upsertPromo('TOP_RIGHT' as never, {
        mediaAssetId: 'asset-1',
        title: 'Promo',
        ctaHref: '/',
        actorId: 'admin-user-1',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    })
  })

  it('preserves an unchanged legacy seller image after its product is unpublished', async () => {
    const prisma = createPrismaMock()
    prisma.homeSlide.findUnique.mockResolvedValue(existingSlide())
    const service = createHomeCmsService({ prisma: prisma as never })

    await expect(
      service.updateSlide('slide-1', {
        mediaAssetId: 'legacy-seller-image',
        title: 'Güncel slayt',
        actorId: 'admin-user-1',
      }),
    ).resolves.toMatchObject({ id: 'slide-1' })
    expect(prisma.mediaAsset.findUnique).not.toHaveBeenCalled()
    expect(prisma.productImage.findFirst).not.toHaveBeenCalled()
  })

  it('preserves an unchanged promo image after its product is unpublished', async () => {
    const prisma = createPrismaMock()
    prisma.homePromo.findUnique.mockResolvedValue({
      id: 'promo-1',
      mediaAssetId: 'legacy-seller-image',
      title: 'Eski promo',
      isActive: true,
    })
    const service = createHomeCmsService({ prisma: prisma as never })

    await expect(
      service.upsertPromo('TOP_RIGHT' as never, {
        mediaAssetId: 'legacy-seller-image',
        title: 'Güncel promo',
        ctaHref: '/',
        actorId: 'admin-user-1',
      }),
    ).resolves.toMatchObject({ id: 'promo-1' })
    expect(prisma.mediaAsset.findUnique).not.toHaveBeenCalled()
    expect(prisma.productImage.findFirst).not.toHaveBeenCalled()
  })
})
