import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WEB_URL, getCustomerInvoiceUrl, getCustomerOrderUrl, getWebBaseUrl } from '../../api/lib/platform-info'

afterEach(() => vi.unstubAllEnvs())

describe('customer web origin', () => {
  it('uses the configured customer origin independently of the current panel', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://satici.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', ' https://customer.example/// ')
    expect(getWebBaseUrl()).toBe('https://customer.example')
  })

  it('falls back to the canonical customer website for absent or blank configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://admin.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', '')
    delete process.env.NEXT_PUBLIC_WEB_URL
    expect(getWebBaseUrl()).toBe(DEFAULT_WEB_URL)
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', '  ')
    expect(getWebBaseUrl()).toBe(DEFAULT_WEB_URL)
  })

  it('encodes route identifiers and only adds the supported download parameter', () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://customer.example')
    expect(getCustomerOrderUrl('order/with ?query')).toBe('https://customer.example/siparis/order%2Fwith%20%3Fquery')
    expect(getCustomerInvoiceUrl('o/1', 's?1', true)).toBe('https://customer.example/api/orders/o%2F1/documents/invoices/s%3F1?download=1')
  })
})
