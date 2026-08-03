import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { createPrismaForRoute, getMediaMaxSizeBytes, readObject } = vi.hoisted(() => ({
  createPrismaForRoute: vi.fn(),
  getMediaMaxSizeBytes: vi.fn((folder: string) =>
    folder === 'documents' || folder === 'customer-support' ? 20 * 1024 * 1024 : 10 * 1024 * 1024,
  ),
  readObject: vi.fn(),
}))

vi.mock('../../api/lib/prisma', () => ({ createPrismaForRoute }))
vi.mock('../../api/lib/r2', () => ({
  getMediaMaxSizeBytes,
  readObject,
  generatePresignedUploadUrl: vi.fn(),
  deleteObject: vi.fn(),
  uploadObject: vi.fn(),
  SLIDER_VIDEO_MIME_TYPES: new Set<string>(),
}))

import { fetchPrivateMedia, fetchPublicMedia } from '../../api/routes/media'

const publicSource = 'https://media.hanuja.tr/products/user-1/asset.jpg'

function publicRequest(sourceUrl: string) {
  return new NextRequest(
    `https://www.hanuja.tr/api/media/fetch?src=${encodeURIComponent(sourceUrl)}`,
  )
}

function prismaWithAsset(asset: { id: string; key: string | null; folder?: string | null } | null) {
  return {
    mediaAsset: {
      findFirst: vi.fn().mockResolvedValue(asset),
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('public media proxy authorization', () => {
  it('reads only a managed public-prefix key', async () => {
    readObject.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      sizeBytes: 3,
    })

    const response = await fetchPublicMedia(publicRequest(publicSource))

    expect(response.status).toBe(200)
    expect(readObject).toHaveBeenCalledWith('products/user-1/asset.jpg')
    expect(response.headers.get('Cache-Control')).toContain('public')
  })

  it('rejects a foreign r2.dev hostname before reading storage', async () => {
    const response = await fetchPublicMedia(
      publicRequest('https://foreign-bucket.r2.dev/products/user-1/asset.jpg'),
    )

    expect(response.status).toBe(400)
    expect(readObject).not.toHaveBeenCalled()
  })

  it.each([
    'https://media.hanuja.tr/products//user-1/asset.jpg',
    'https://media.hanuja.tr/products/%2e%2e/returns/user-1/asset.jpg',
    'https://media.hanuja.tr/products%2Fuser-1%2Fasset.jpg',
    'https://media.hanuja.tr//products/user-1/asset.jpg',
  ])('rejects malformed or traversal-like key %s', async (sourceUrl) => {
    const response = await fetchPublicMedia(publicRequest(sourceUrl))

    expect(response.status).toBe(400)
    expect(readObject).not.toHaveBeenCalled()
  })

  it('rejects a managed host when its key has a non-public prefix', async () => {
    const response = await fetchPublicMedia(
      publicRequest('https://media.hanuja.tr/returns/customer-1/private.jpg'),
    )

    expect(response.status).toBe(400)
    expect(readObject).not.toHaveBeenCalled()
  })
})

describe('private media authorization', () => {
  it('requires an authenticated viewer and marks the response private', async () => {
    const response = await fetchPrivateMedia('asset-1', null)

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(createPrismaForRoute).not.toHaveBeenCalled()
  })

  it('returns the same not-found response for a nonparticipant without reading storage', async () => {
    const prisma = prismaWithAsset(null)
    createPrismaForRoute.mockReturnValue(prisma)

    const response = await fetchPrivateMedia('asset-1', {
      viewerId: 'other-customer',
      viewerRole: 'customer',
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(readObject).not.toHaveBeenCalled()
  })

  it('scopes return, seller-support, and customer-support participants in the private query', async () => {
    const prisma = prismaWithAsset({
      id: 'asset-1',
      key: 'returns/customer-1/asset.jpg',
      folder: 'returns',
    })
    createPrismaForRoute.mockReturnValue(prisma)
    readObject.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
      sizeBytes: 3,
    })

    const response = await fetchPrivateMedia('asset-1', {
      viewerId: 'customer-1',
      viewerRole: 'customer',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(readObject).toHaveBeenCalledWith('returns/customer-1/asset.jpg', 10 * 1024 * 1024)

    const where = prisma.mediaAsset.findFirst.mock.calls[0]![0].where
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { returnRequest: { customerId: 'customer-1' } },
        {
          returnRequest: {
            order: { lines: { some: { seller: { userId: 'customer-1' } } } },
          },
        },
        {
          supportAttachments: {
            some: {
              message: {
                ticket: { seller: { userId: 'customer-1' } },
              },
            },
          },
        },
        {
          customerSupportAttachments: {
            some: { message: { ticket: { customerId: 'customer-1' } } },
          },
        },
      ]),
    )
  })

  it('allows an admin to retrieve an asset without a participant relation', async () => {
    const prisma = prismaWithAsset({
      id: 'asset-1',
      key: 'disputes/customer-1/asset.jpg',
      folder: 'disputes',
    })
    createPrismaForRoute.mockReturnValue(prisma)
    readObject.mockResolvedValue({
      body: new Uint8Array([1]),
      contentType: 'image/jpeg',
      sizeBytes: 1,
    })

    const response = await fetchPrivateMedia('asset-1', {
      viewerId: 'admin-1',
      viewerRole: 'admin',
    })

    expect(response.status).toBe(200)
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-1', status: 'ready', key: { not: null } },
      select: { id: true, key: true, folder: true },
    })
  })

  it('uses the 20 MiB limit for customer-support documents', async () => {
    const prisma = prismaWithAsset({
      id: 'asset-1',
      key: 'customer-support/customer-1/attachment.pdf',
      folder: 'customer-support',
    })
    createPrismaForRoute.mockReturnValue(prisma)
    readObject.mockResolvedValue({
      body: new Uint8Array([1]),
      contentType: 'application/pdf',
      sizeBytes: 1,
    })

    const response = await fetchPrivateMedia('asset-1', {
      viewerId: 'customer-1',
      viewerRole: 'customer',
    })

    expect(response.status).toBe(200)
    expect(readObject).toHaveBeenCalledWith(
      'customer-support/customer-1/attachment.pdf',
      20 * 1024 * 1024,
    )
  })
})
