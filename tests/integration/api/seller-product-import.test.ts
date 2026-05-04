import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  createPrismaForRouteMock,
  previewMock,
  resolveAdapterMock,
  commitMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  createPrismaForRouteMock: vi.fn(),
  previewMock: vi.fn(),
  resolveAdapterMock: vi.fn(),
  commitMock: vi.fn(),
}))

let prismaMock: Record<string, unknown>

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}))

vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: createPrismaForRouteMock,
}))

vi.mock('@hanuja/api/services/product-import/import.service', () => ({
  createProductImportService: vi.fn(() => ({
    preview: previewMock,
    resolveAdapter: resolveAdapterMock,
    commit: commitMock,
  })),
}))

function createPrismaMock(opts?: {
  seller?: {
    id: string
    status?: string
    sellerNumber?: number
    userId?: string
  } | null
}) {
  const seller =
    opts?.seller === undefined
      ? {
          id: 'seller-1',
          status: 'active',
          sellerNumber: 42,
          userId: 'seller-user-1',
        }
      : opts.seller

  return {
    seller: {
      findUnique: vi.fn(async () => seller),
    },
  }
}

function makePreviewItem() {
  return {
    externalId: 'hipicon-1',
    name: 'Hipicon Ürün',
    price: 1200,
    imageUrls: ['https://cdn.example/item.jpg'],
    externalUrl: 'https://www.hipicon.com/urun/hipicon-urun',
    suggestedCategoryName: 'Ev / Aydınlatma / Tavan Sarkıt',
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()

  prismaMock = createPrismaMock()
  createPrismaForRouteMock.mockReturnValue(prismaMock)

  getSessionMock.mockResolvedValue({
    user: {
      id: 'seller-user-1',
      role: 'seller',
    },
  })

  previewMock.mockResolvedValue({
    adapter: 'hipicon',
    items: [makePreviewItem()],
    fetchedCount: 1,
    totalCount: 1,
    isPartial: false,
  })

  resolveAdapterMock.mockReturnValue({ name: 'hipicon' })
  commitMock.mockResolvedValue([
    {
      id: 'product-1',
      name: 'Hipicon Ürün',
      barcode: '4200000012345',
    },
  ])
})

describe('Seller product URL import routes', () => {
  it('rejects unauthenticated preview and commit requests', async () => {
    getSessionMock.mockResolvedValue(null)

    const previewRoute =
      await import('../../../apps/seller-panel/src/app/api/seller/products/import/preview/route.ts')
    const commitRoute =
      await import('../../../apps/seller-panel/src/app/api/seller/products/import/commit/route.ts')

    const previewResponse = await previewRoute.POST(
      new Request('http://localhost/api/seller/products/import/preview', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://www.hipicon.com/magaza' }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    )

    const commitResponse = await commitRoute.POST(
      new Request('http://localhost/api/seller/products/import/commit', {
        method: 'POST',
        body: JSON.stringify({
          adapter: 'hipicon',
          externalUrl: 'https://www.hipicon.com/magaza',
          items: [makePreviewItem()],
          selections: [{ externalId: 'hipicon-1', categoryId: 'category-1' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    )

    expect(previewResponse.status).toBe(401)
    expect(commitResponse.status).toBe(401)
  })

  it('rejects users without a seller account', async () => {
    prismaMock = createPrismaMock({ seller: null })
    createPrismaForRouteMock.mockReturnValue(prismaMock)

    const previewRoute =
      await import('../../../apps/seller-panel/src/app/api/seller/products/import/preview/route.ts')

    const response = await previewRoute.POST(
      new Request('http://localhost/api/seller/products/import/preview', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://www.hipicon.com/magaza' }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Satıcı hesabı bulunamadı.' })
  })

  it('rejects inactive sellers', async () => {
    prismaMock = createPrismaMock({
      seller: {
        id: 'seller-1',
        status: 'pending',
        sellerNumber: 42,
        userId: 'seller-user-1',
      },
    })
    createPrismaForRouteMock.mockReturnValue(prismaMock)

    const previewRoute =
      await import('../../../apps/seller-panel/src/app/api/seller/products/import/preview/route.ts')

    const response = await previewRoute.POST(
      new Request('http://localhost/api/seller/products/import/preview', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://www.hipicon.com/magaza' }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    )

    expect(response.status).toBe(403)
  })

  it('returns Hipicon preview data for the active seller', async () => {
    const previewRoute =
      await import('../../../apps/seller-panel/src/app/api/seller/products/import/preview/route.ts')

    const response = await previewRoute.POST(
      new Request('http://localhost/api/seller/products/import/preview', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://www.hipicon.com/magaza' }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      adapter: 'hipicon',
      items: [makePreviewItem()],
      fetchedCount: 1,
      totalCount: 1,
      isPartial: false,
    })
    expect(previewMock).toHaveBeenCalledWith('https://www.hipicon.com/magaza', 42)
  })

  it('commits selected products to the authenticated seller only', async () => {
    const commitRoute =
      await import('../../../apps/seller-panel/src/app/api/seller/products/import/commit/route.ts')

    const response = await commitRoute.POST(
      new Request('http://localhost/api/seller/products/import/commit', {
        method: 'POST',
        body: JSON.stringify({
          adapter: 'hipicon',
          externalUrl: 'https://www.hipicon.com/magaza',
          items: [makePreviewItem()],
          selections: [{ externalId: 'hipicon-1', categoryId: 'category-1', barcode: '4200000012345' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      importedCount: 1,
      selectedCount: 1,
      items: [
        {
          id: 'product-1',
          name: 'Hipicon Ürün',
          barcode: '4200000012345',
        },
      ],
    })
    expect(resolveAdapterMock).toHaveBeenCalledWith('https://www.hipicon.com/magaza')
    expect(commitMock).toHaveBeenCalledWith({
      sellerId: 'seller-1',
      sellerNumber: 42,
      ownerId: 'seller-user-1',
      items: [makePreviewItem()],
      selections: [{ externalId: 'hipicon-1', categoryId: 'category-1', barcode: '4200000012345' }],
    })
  })

  it('rejects commits without selected products', async () => {
    const commitRoute =
      await import('../../../apps/seller-panel/src/app/api/seller/products/import/commit/route.ts')

    const response = await commitRoute.POST(
      new Request('http://localhost/api/seller/products/import/commit', {
        method: 'POST',
        body: JSON.stringify({
          adapter: 'hipicon',
          externalUrl: 'https://www.hipicon.com/magaza',
          items: [makePreviewItem()],
          selections: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'En az bir ürün seçilmelidir.' })
  })
})
