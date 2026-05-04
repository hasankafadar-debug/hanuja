import { afterEach, describe, expect, it, vi } from 'vitest'
import { HipiconAdapter } from '../../api/services/product-import/adapters/hipicon.adapter'

function mockResponse({
  body,
  text = '',
  url = 'https://www.hipicon.com/mosaiss',
}: {
  body?: unknown
  text?: string
  url?: string
}) {
  return {
    ok: true,
    url,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(text),
  }
}

function mockHipiconFetch(detail: Record<string, unknown>, listProduct: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input)

    if (url.endsWith('/robots.txt')) {
      return mockResponse({ text: '' })
    }

    if (url === 'https://www.hipicon.com/mosaiss') {
      return mockResponse({ url: 'https://www.hipicon.com/mosaiss' })
    }

    if (url.includes('/designers/products/mosaiss')) {
      return mockResponse({
        body: {
          data: {
            productList: [
              {
                id: '761868',
                name: 'Arcobaleno Yan Sehpa',
                displayPrice: 65750,
                productPath: '/mosaiss/arcobaleno-yan-sehpa',
                imageURL: 'https://cdn.hipicon.com/product.jpg',
                ...listProduct,
              },
            ],
            productListDetail: { totalProductCount: 1, totalPageCount: 1 },
          },
        },
      })
    }

    if (url.endsWith('/products/761868')) {
      return mockResponse({ body: { data: detail } })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
}

describe('HipiconAdapter stockCode mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('maps alphanumeric stockCode to sku without using it as a barcode', async () => {
    mockHipiconFetch({ stockCode: 'MSSY12' })

    const result = await new HipiconAdapter().fetchProducts('https://www.hipicon.com/mosaiss')

    expect(result.items[0]?.sku).toBe('MSSY12')
    expect(result.items[0]?.barcode).toBeUndefined()
  })

  it('uses numeric stockCode as a barcode candidate when Hipicon has no barcode', async () => {
    mockHipiconFetch({ stockCode: '12345' })

    const result = await new HipiconAdapter().fetchProducts('https://www.hipicon.com/mosaiss')

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        sku: '12345',
        barcode: '12345',
      }),
    )
  })
})
