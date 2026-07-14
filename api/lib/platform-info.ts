export const DEFAULT_WEB_URL = 'https://www.hanuja.com.tr'
export const DEFAULT_SELLER_PANEL_URL = 'https://satici.hanuja.com.tr'
export const DEFAULT_ADMIN_PANEL_URL = 'https://admin.hanuja.com.tr'
export const DEFAULT_MEDIA_HOSTNAME = 'media.hanuja.com.tr'
export const DEFAULT_CDN_HOSTNAME = 'cdn.hanuja.com.tr'
export const LEGACY_CDN_HOSTNAME = 'cdn.hanuja.com'

export const PLATFORM_LEGAL_INFO = {
  /** Public brand name shown in footer copyright, UI headers, and non-legal surfaces. */
  brandDisplay: 'Hanuja Dijital',
  companyName: 'Suat Salih Ayk. ve Dri. Urn. Teks. San. ve Tic. Ltd. Sti',
  companyNameDisplay: 'Suat Salih Ayk. ve Dri. Ürn. Teks. San. ve Tic. Ltd. Şti.',
  address: 'Egemenlik Mah. 6124/2 Sk. No:3 Bornova / İZMİR',
  city: 'İzmir',
  district: 'Bornova',
  taxOffice: 'Hasan Tahsin',
  taxNumber: '7810515555',
  mersis: '0781-0515-5550-0001',
  supportEmail: 'destek@hanuja.com.tr',
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
  return (process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_WEB_URL).replace(/\/$/, '')
}

export function getSellerPanelUrl() {
  return (process.env.NEXT_PUBLIC_SELLER_PANEL_URL ?? DEFAULT_SELLER_PANEL_URL).replace(/\/$/, '')
}

export function getAdminPanelUrl() {
  return (process.env.NEXT_PUBLIC_ADMIN_PANEL_URL ?? DEFAULT_ADMIN_PANEL_URL).replace(/\/$/, '')
}
