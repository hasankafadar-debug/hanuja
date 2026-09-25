import { getWebBaseUrl, PLATFORM_LEGAL_INFO } from '../platform-info'
import { escapeHtml } from './shared'

/** A marketing message must lead to our own token-bearing unsubscribe action. */
export function isValidMarketingUnsubscribeUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value.trim())
    const app = new URL(getWebBaseUrl())
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && app.protocol === 'http:')) &&
      url.origin === app.origin &&
      url.pathname === '/api/marketing/unsubscribe' &&
      Boolean(url.searchParams.get('token')?.trim()) &&
      !url.username && !url.password
    )
  } catch {
    return false
  }
}

export function assertValidMarketingUnsubscribeUrl(value: string | null | undefined): asserts value is string {
  if (!isValidMarketingUnsubscribeUrl(value)) {
    throw new Error('Geçerli abonelikten çıkış bağlantısı olmadan kampanya e-postası oluşturulamaz.')
  }
}

export function marketingFooterHtml(unsubscribeUrl: string): string {
  assertValidMarketingUnsubscribeUrl(unsubscribeUrl)
  return `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#777;">
    ${escapeHtml(PLATFORM_LEGAL_INFO.companyNameDisplay)}<br />
    MERSİS: ${escapeHtml(PLATFORM_LEGAL_INFO.mersis)}<br />
    İletişim: <a href="mailto:${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}">${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}</a><br />
    Kampanya e-postaları için <a href="${escapeHtml(unsubscribeUrl.trim())}">abonelikten çıkın</a>.
  </p>`
}

export function marketingFooterText(unsubscribeUrl: string): string {
  assertValidMarketingUnsubscribeUrl(unsubscribeUrl)
  return [
    PLATFORM_LEGAL_INFO.companyNameDisplay,
    `MERSİS: ${PLATFORM_LEGAL_INFO.mersis}`,
    `İletişim: ${PLATFORM_LEGAL_INFO.supportEmail}`,
    `Kampanya e-postalarından çıkış: ${unsubscribeUrl.trim()}`,
  ].join('\n')
}
