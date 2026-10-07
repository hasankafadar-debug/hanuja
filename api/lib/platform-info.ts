export const DEFAULT_WEB_URL = 'https://www.hanuja.com.tr'
export const DEFAULT_SELLER_PANEL_URL = 'https://satici.hanuja.com.tr'
export const DEFAULT_ADMIN_PANEL_URL = 'https://admin.hanuja.com.tr'
export const DEFAULT_MEDIA_HOSTNAME = 'media.hanuja.tr'
export const LEGACY_MEDIA_HOSTNAME = 'media.hanuja.com.tr'
export const DEFAULT_CDN_HOSTNAME = 'cdn.hanuja.com.tr'
export const LEGACY_CDN_HOSTNAME = 'cdn.hanuja.com'

export const PLATFORM_LEGAL_INFO = {
  /** Public brand name shown in footer copyright, UI headers, and non-legal surfaces. */
  brandDisplay: 'Hanuja Dijital',
  companyName: 'Suat Salih Ayk. ve Dri. Urn. Teks. San. ve Tic. Ltd. Sti',
  companyNameDisplay: 'Suat Salih Ayk. ve Dri. Ürn. Teks. San. ve Tic. Ltd. Şti.',
  /** Unabbreviated trade name — used by the KVKK and cookie notices (/kvkk, /cerez-politikasi). */
  companyLegalName: 'Suat Salih Ayakkabı ve Deri Ürünleri Tekstil Sanayi ve Ticaret Ltd. Şti.',
  address: 'Egemenlik Mah. 6124/2 Sk. No:3 Bornova / İZMİR',
  city: 'İzmir',
  district: 'Bornova',
  taxOffice: 'Hasan Tahsin',
  taxNumber: '7810515555',
  mersis: '0781-0515-5550-0001',
  supportEmail: 'admin@hanuja.com.tr',
  transactionalEmail: 'noreply@hanuja.com.tr',
  kvkkEmail: 'suatsalihayakkabideri@hs01.kep.tr',
  phoneDisplay: '0 (507) 551 57 77',
  phoneHref: 'tel:+905075515777',
  domain: 'hanuja.com.tr',
  websiteUrl: DEFAULT_WEB_URL,
} as const

export type PlatformBankInfo = {
  bankName: string
  accountHolder: string
  accountHolderNote?: string | null
  iban: string
  branchName?: string | null
  reference: string
  missing?: boolean
}

/**
 * @deprecated DB-first yaklaşım için getPlatformBankAccounts() kullanın.
 * Yalnızca DB yokken fallback (seed/migration öncesi) olarak env-var okur.
 */
export function getPlatformBankInfo(orderReference: string): PlatformBankInfo {
  const bankName = process.env['PLATFORM_BANK_NAME']?.trim() ?? ''
  const accountHolder = process.env['PLATFORM_BANK_HOLDER']?.trim() ?? ''
  const iban = process.env['PLATFORM_BANK_IBAN']?.trim() ?? ''

  if (!bankName || !accountHolder || !iban) {
    return {
      bankName: '',
      accountHolder: '',
      iban: '',
      reference: orderReference,
      missing: true,
    }
  }

  return { bankName, accountHolder, iban, reference: orderReference }
}

export function getWebBaseUrl() {
  return getPlatformBaseUrls().customer
}

export function getCustomerOrderUrl(orderId: string) {
  return `${getWebBaseUrl()}/siparis/${encodeURIComponent(orderId)}`
}

export function getCustomerInvoiceUrl(orderId: string, sellerId: string, download = false) {
  return `${getWebBaseUrl()}/api/orders/${encodeURIComponent(orderId)}/documents/invoices/${encodeURIComponent(sellerId)}${download ? '?download=1' : ''}`
}

export function getSellerPanelUrl() {
  return getPlatformBaseUrls().seller
}

export function getAdminPanelUrl() {
  return getPlatformBaseUrls().admin
}

export type PlatformAudience = 'customer' | 'seller' | 'admin'

/** App-local NEXT_PUBLIC_APP_URL must never decide another audience's links. */
export function getPlatformBaseUrls(): Record<PlatformAudience, string> {
  const values = {
    customer: process.env.NEXT_PUBLIC_WEB_URL?.trim() || DEFAULT_WEB_URL,
    seller:
      process.env.NEXT_PUBLIC_SELLER_PANEL_URL?.trim() ||
      process.env.SELLER_PANEL_URL?.trim() ||
      DEFAULT_SELLER_PANEL_URL,
    admin:
      process.env.NEXT_PUBLIC_ADMIN_PANEL_URL?.trim() ||
      process.env.ADMIN_PANEL_URL?.trim() ||
      DEFAULT_ADMIN_PANEL_URL,
  }
  const result = {} as Record<PlatformAudience, string>
  for (const role of ['customer', 'seller', 'admin'] as const) {
    let url: URL
    try {
      url = new URL(values[role].replace(/\/+$/, ''))
    } catch {
      throw new Error('EMAIL_BASE_URL_INVALID:' + role)
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (process.env.NODE_ENV === 'production' &&
        (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new Error('EMAIL_BASE_URL_INVALID:' + role)
    result[role] = url.origin
  }
  if (
    new Set(Object.values(result)).size !== 3 ||
    [
      DEFAULT_SELLER_PANEL_URL,
      DEFAULT_ADMIN_PANEL_URL,
      process.env.SELLER_PANEL_URL,
      process.env.ADMIN_PANEL_URL,
    ].some((value) => {
      if (!value) return false
      try {
        return new URL(value.trim()).origin === result.customer
      } catch {
        return false
      }
    })
  )
    throw new Error('EMAIL_BASE_URL_ROLE_MISMATCH')
  return result
}

export function getPlatformLink(role: PlatformAudience, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes(String.fromCharCode(92)))
    throw new Error('EMAIL_LINK_PATH_INVALID')
  return getPlatformBaseUrls()[role] + path
}

export function getCustomerContractLinks(orderId: string) {
  const base = getPlatformLink(
    'customer',
    '/api/orders/' + encodeURIComponent(orderId) + '/documents/contracts',
  )
  return {
    preInformationUrl: base + '/pre-information?goruntule=1',
    distanceSalesUrl: base + '/distance-sales?goruntule=1',
  }
}

export function getSellerOrderUrl(orderId: string) {
  return getPlatformLink('seller', '/siparisler/' + encodeURIComponent(orderId))
}
