import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getSession, getContractForCustomer, getForCustomer, readFile, sellerInvoiceLookup } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    getContractForCustomer: vi.fn(),
    getForCustomer: vi.fn(),
    readFile: vi.fn(),
    sellerInvoiceLookup: vi.fn(),
  }),
)

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))
vi.mock('@/lib/login-redirect', async () => {
  const actual = await vi.importActual<typeof import('../../apps/web/src/lib/login-redirect')>(
    '../../apps/web/src/lib/login-redirect',
  )
  return actual
})
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/services/order-document.service', () => ({
  createOrderDocumentService: () => ({
    getContractForCustomer,
    // The seller's invoice to Hanuja must never be read for a customer request.
    getInvoiceForSeller: sellerInvoiceLookup,
    getInvoiceForAdmin: sellerInvoiceLookup,
    readInvoiceFile: sellerInvoiceLookup,
  }),
}))
vi.mock('@hanuja/api/services/customer-invoice.service', () => ({
  createCustomerInvoiceService: () => ({ getForCustomer, readFile }),
}))

import { GET as contractGet } from '../../apps/web/src/app/api/orders/[id]/documents/contracts/[kind]/route'
import { GET as invoiceGet } from '../../apps/web/src/app/api/orders/[id]/documents/customer-invoice/route'
import { GET as legacyInvoiceGet } from '../../apps/web/src/app/api/orders/[id]/documents/invoices/[sellerId]/route'

const contractParams = { params: Promise.resolve({ id: 'order-1', kind: 'distance-sales' }) }
const invoiceParams = { params: Promise.resolve({ id: 'order-1' }) }
const legacyInvoiceParams = { params: Promise.resolve({ id: 'order-1', sellerId: 'seller-1' }) }

function req(url: string) {
  return new NextRequest(url)
}

describe('order document links used in e-mails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getContractForCustomer.mockResolvedValue({
      distanceSalesHtml: '<html>sozlesme</html>',
      preInformationHtml: '<html>on bilgi</html>',
    })
    getForCustomer.mockResolvedValue({
      fileKey: 'private/v1/aa/x.bin',
      fileName: 'fatura.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    })
    readFile.mockResolvedValue({ body: new Uint8Array([1]), sizeBytes: 1 })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sends a signed-out contract reader to login and back to the same document', async () => {
    getSession.mockResolvedValue(null)
    const response = await contractGet(
      req('http://localhost/api/orders/order-1/documents/contracts/distance-sales?goruntule=1'),
      contractParams,
    )
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/giris')
    expect(location.searchParams.get('callbackUrl')).toBe(
      '/api/orders/order-1/documents/contracts/distance-sales?goruntule=1',
    )
    expect(getContractForCustomer).not.toHaveBeenCalled()
  })

  it('sends a signed-out invoice reader to login and back, keeping the download flag', async () => {
    getSession.mockResolvedValue(null)
    const response = await invoiceGet(
      req('http://localhost/api/orders/order-1/documents/customer-invoice?download=1'),
      invoiceParams,
    )
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).searchParams.get('callbackUrl')).toBe(
      '/api/orders/order-1/documents/customer-invoice?download=1',
    )
    expect(getForCustomer).not.toHaveBeenCalled()
  })

  it('uses the customer origin behind a production reverse proxy, ignoring panel and forwarded hosts', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://satici.hanuja.com.tr')
    getSession.mockResolvedValue(null)
    const response = await invoiceGet(new NextRequest(
      'https://0.0.0.0:3000/api/orders/order-1/documents/customer-invoice?download=1',
      { headers: { 'x-forwarded-host': 'attacker.example.test' } },
    ), invoiceParams)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin).toBe('https://www.hanuja.com.tr')
    expect(location.pathname).toBe('/giris')
    expect(location.searchParams.get('callbackUrl')).toBe('/api/orders/order-1/documents/customer-invoice?download=1')
    expect(getForCustomer).not.toHaveBeenCalled()
  })

  it('scopes the document lookup to the signed-in customer', async () => {
    getSession.mockResolvedValue({ user: { id: 'customer-1' } })
    await contractGet(req('http://localhost/api/orders/order-1/documents/contracts/distance-sales'), contractParams)
    expect(getContractForCustomer).toHaveBeenCalledWith('order-1', 'customer-1')

    await invoiceGet(req('http://localhost/api/orders/order-1/documents/customer-invoice'), invoiceParams)
    expect(getForCustomer).toHaveBeenCalledWith('order-1', 'customer-1')
    expect(sellerInvoiceLookup).not.toHaveBeenCalled()
  })

  it("redirects old designer-invoice links to Hanuja's invoice without reading the seller's file", async () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
    getSession.mockResolvedValue({ user: { id: 'customer-1' } })
    const response = await legacyInvoiceGet(
      req('http://localhost/api/orders/order-1/documents/invoices/seller-1?download=1'),
      legacyInvoiceParams,
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://www.hanuja.com.tr/api/orders/order-1/documents/customer-invoice?download=1',
    )
    expect(sellerInvoiceLookup).not.toHaveBeenCalled()
    expect(getForCustomer).not.toHaveBeenCalled()
  })

  it("returns not-found when another customer opens the order's invoice", async () => {
    getSession.mockResolvedValue({ user: { id: 'other-customer' } })
    const { NotFoundError } = await import('../../api/lib/errors')
    getForCustomer.mockRejectedValue(new NotFoundError('Fatura'))
    const response = await invoiceGet(req('http://localhost/api/orders/order-1/documents/customer-invoice'), invoiceParams)
    expect(response.status).toBe(404)
    expect(readFile).not.toHaveBeenCalled()
  })

  it('renders inline only for the e-mail view link and downloads otherwise', async () => {
    getSession.mockResolvedValue({ user: { id: 'customer-1' } })
    const view = await contractGet(
      req('http://localhost/api/orders/order-1/documents/contracts/distance-sales?goruntule=1'),
      contractParams,
    )
    expect(view.headers.get('content-disposition')).toContain('inline')

    const download = await contractGet(
      req('http://localhost/api/orders/order-1/documents/contracts/distance-sales'),
      contractParams,
    )
    expect(download.headers.get('content-disposition')).toContain('attachment')
  })

  it('propagates a not-found for another customer order instead of leaking the document', async () => {
    getSession.mockResolvedValue({ user: { id: 'other-customer' } })
    const { NotFoundError } = await import('../../api/lib/errors')
    getContractForCustomer.mockRejectedValue(new NotFoundError('Sipariş', 'order-1'))
    const response = await contractGet(
      req('http://localhost/api/orders/order-1/documents/contracts/distance-sales'),
      contractParams,
    )
    expect(response.status).toBe(404)
  })
})
