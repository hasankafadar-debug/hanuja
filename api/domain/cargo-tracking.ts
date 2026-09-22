/**
 * Kargo takip bağlantıları — müşteri kargo e-postası ve sipariş sayfası için.
 *
 * Yalnız doğrulanmış https sayfaları listelenir (2026-09-22 kontrolü). Takip
 * numarasını URL'den kabul etmeyen sağlayıcılarda sayfanın kendisi verilir;
 * müşteri numarayı e-postadan kopyalar. Listede olmayan/`unknown` sağlayıcı
 * için `null` döner ve şablon yalnız takip numarasını basar.
 */

type TrackingUrlBuilder = (trackingNumber: string) => string

const TRACKING_URL_BUILDERS: Record<string, TrackingUrlBuilder> = {
  yurtiçi: (code) =>
    `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${code}`,
  aras: (code) => `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${code}`,
  sürat: (code) => `https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=${code}`,
  // MNG Kargo takip sayfası DHL eCommerce'e yönlendiriyor; URL'den numara kabul etmiyor.
  mng: () => 'https://www.dhlecommerce.com.tr/gonderitakip',
  ups: (code) => `https://www.ups.com/track?loc=tr_TR&tracknum=${code}`,
  fedex: (code) => `https://www.fedex.com/fedextrack/?trknbr=${code}`,
  dhl: (code) => `https://www.dhl.com/tr-tr/home/tracking.html?tracking-id=${code}`,
}

const PROVIDER_LABELS: Record<string, string> = {
  yurtiçi: 'Yurtiçi Kargo',
  aras: 'Aras Kargo',
  ptt: 'PTT Kargo',
  mng: 'MNG Kargo',
  sürat: 'Sürat Kargo',
  ups: 'UPS',
  fedex: 'FedEx',
  dhl: 'DHL',
}

export function normalizeCargoProvider(provider: string | null | undefined): string {
  return (provider ?? '').trim().toLocaleLowerCase('tr-TR')
}

/** Human-readable carrier name; unknown providers fall back to the raw value or "Kargo". */
export function cargoProviderLabel(provider: string | null | undefined): string {
  const key = normalizeCargoProvider(provider)
  if (!key || key === 'unknown') return 'Kargo'
  return PROVIDER_LABELS[key] ?? provider!.trim()
}

/** Only digits, letters and dashes survive; anything else is not a safe URL component. */
function sanitizeTrackingNumber(trackingNumber: string): string | null {
  const trimmed = trackingNumber.trim()
  if (!trimmed || trimmed.length > 64) return null
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) return null
  return trimmed
}

export function buildCargoTrackingUrl(
  provider: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const key = normalizeCargoProvider(provider)
  const builder = TRACKING_URL_BUILDERS[key]
  if (!builder || !trackingNumber) return null
  const code = sanitizeTrackingNumber(trackingNumber)
  if (!code) return null
  return builder(encodeURIComponent(code))
}
