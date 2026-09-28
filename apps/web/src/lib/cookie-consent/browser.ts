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
  const element = document.createElement('script')
  element.src = script.src
  element.async = true
  element.dataset['consentScript'] = script.id
  element.dataset['consentCategory'] = script.category
  document.head.appendChild(element)
}
