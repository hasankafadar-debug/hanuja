import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as sellerGet } from '../../../apps/seller-panel/src/app/api/orders/[id]/documents/invoices/[sellerId]/route'
import { GET as adminGet } from '../../../apps/admin-panel/src/app/api/orders/[id]/documents/invoices/[sellerId]/route'

afterEach(() => vi.unstubAllEnvs())

describe.each([['seller', sellerGet], ['admin', adminGet]] as const)('%s old invoice links', (_name, get) => {
  it('redirects to the customer site without serving the file or retaining unrelated query parameters', async () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://satici.hanuja.com.tr')
    const req = new NextRequest('https://untrusted.example/api/orders/o1/documents/invoices/s1?download=1&next=https://evil.example')
    const response = await get(req, { params: Promise.resolve({ id: 'o1', sellerId: 's1' }) })
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe('https://www.hanuja.com.tr/api/orders/o1/documents/invoices/s1?download=1')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('ignores unsupported download values and encodes identifiers as path segments', async () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', '')
    delete process.env.NEXT_PUBLIC_WEB_URL
    const response = await get(new NextRequest('https://admin.hanuja.com.tr/api/orders/o1/documents/invoices/s1?download=0'), {
      params: Promise.resolve({ id: 'o/1', sellerId: 's?1' }),
    })
    expect(response.headers.get('Location')).toBe('https://www.hanuja.com.tr/api/orders/o%2F1/documents/invoices/s%3F1')
  })
})
