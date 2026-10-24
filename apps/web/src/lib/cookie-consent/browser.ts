'use client'

/**
 * The only storefront module that writes browser storage or `document.cookie`.
 * tests/security/client-tracking-guard.test.ts fails if another file starts doing so.
 * Every read and write is guarded: storage can be unavailable (private mode, blocked
 * site data) and the page must keep working with optional scripts off.
 */
import {
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_NOTICE_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
} from '@hanuja/api/lib/cookie-policy'
import { isNoticeAcknowledged, parseStoredConsent, type StoredConsent } from './state'
import type { ConsentScript, WithdrawalCleanup } from './scripts'
import { analyticsPagePath, GOOGLE_ANALYTICS_MEASUREMENT_ID } from '@hanuja/api/lib/storefront-analytics'

type AnalyticsWindow = Window & {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
} & { [key in `ga-disable-${typeof GOOGLE_ANALYTICS_MEASUREMENT_ID}`]?: boolean }

function isAnalyticsHost(): boolean {
  return window.location.hostname === 'www.hanuja.com.tr' || window.location.hostname === 'hanuja.com.tr'
}

function analyticsLocation(pathname: string): string {
  return `${window.location.origin}${analyticsPagePath(pathname)}`
}

function initializeGoogleAnalytics(): void {
  const target = window as AnalyticsWindow
  target.dataLayer ??= []
  target.gtag ??= function () {
    // eslint-disable-next-line prefer-rest-params -- Google's gtag command queue uses Arguments objects.
    target.dataLayer?.push(arguments)
  }
  target[`ga-disable-${GOOGLE_ANALYTICS_MEASUREMENT_ID}`] = false
  target.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
  })
  target.gtag('js', new Date())
  target.gtag('set', {
    page_location: analyticsLocation(window.location.pathname),
    page_referrer: safeReferrer(document.referrer),
    page_title: 'Hanuja',
  })
  target.gtag('config', GOOGLE_ANALYTICS_MEASUREMENT_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_domain: 'none',
    cookie_flags: 'SameSite=Lax;Secure',
  })
}

function safeReferrer(referrer: string): string {
  if (!referrer) return ''
  try {
    const url = new URL(referrer)
    return url.origin === window.location.origin ? `${url.origin}${analyticsPagePath(url.pathname)}` : url.origin
  } catch {
    return ''
  }
}

let lastAnalyticsPage: string | null = null

/** Called only after the consent provider has applied a recorded analytics grant. */
export function trackAnalyticsPageView(pathname: string): void {
  if (!isAnalyticsHost()) return
  const target = window as AnalyticsWindow
  if (!target.gtag || target[`ga-disable-${GOOGLE_ANALYTICS_MEASUREMENT_ID}`]) return
  const location = analyticsLocation(pathname)
  if (location === lastAnalyticsPage) return
  const context = {
    page_location: location,
    page_referrer: lastAnalyticsPage ?? safeReferrer(document.referrer),
    page_title: 'Hanuja',
  }
  target.gtag('set', context)
  target.gtag('event', 'page_view', { ...context, send_to: GOOGLE_ANALYTICS_MEASUREMENT_ID })
  lastAnalyticsPage = location
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function readStoredConsent(): StoredConsent | null {
  return parseStoredConsent(readLocal(COOKIE_CONSENT_STORAGE_KEY))
}

export function writeStoredConsent(consent: StoredConsent): void {
  writeLocal(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent))
}

export function readNoticeAcknowledged(): boolean {
  return isNoticeAcknowledged(readLocal(COOKIE_NOTICE_STORAGE_KEY))
}

/** Only records that the notice was seen — this is not consent and is never sent to the server. */
export function writeNoticeAcknowledged(): void {
  writeLocal(COOKIE_NOTICE_STORAGE_KEY, COOKIE_POLICY_VERSION)
}

function cookieDomains(hostname: string): (string | null)[] {
  const labels = hostname.split('.')
  const domains: (string | null)[] = [null, hostname]
  for (let i = 1; i < labels.length - 1; i += 1) domains.push(`.${labels.slice(i).join('.')}`)
  return domains
}

export function applyWithdrawalCleanup(cleanup: WithdrawalCleanup): void {
  if (cleanup.scriptIds.includes('google-analytics')) {
    // Stop queued/unload events before deleting the cookies and reloading the page.
    ;(window as AnalyticsWindow)[`ga-disable-${GOOGLE_ANALYTICS_MEASUREMENT_ID}`] = true
    lastAnalyticsPage = null
  }
  for (const name of cleanup.cookies) {
    for (const domain of cookieDomains(window.location.hostname)) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`
    }
  }
  for (const key of cleanup.storageKeys) {
    try {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    } catch {
      // Storage unavailable: nothing was stored there either.
    }
  }
}

export function injectConsentScript(script: ConsentScript): void {
  if (document.querySelector(`script[data-consent-script="${script.id}"]`)) return
  if (script.id === 'google-analytics') {
    // Local development and preview hosts must never pollute production analytics.
    if (!isAnalyticsHost()) return
    initializeGoogleAnalytics()
  }
  const element = document.createElement('script')
  element.src = script.src
  element.async = true
  element.dataset['consentScript'] = script.id
  element.dataset['consentCategory'] = script.category
  document.head.appendChild(element)
}
