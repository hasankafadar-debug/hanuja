'use client'

import { createContext, useContext } from 'react'
import type { CookieNoticeMode, OptionalCookieCategory } from '@hanuja/api/lib/cookie-policy'
import type { ConsentFlags } from '@/lib/cookie-consent/state'

export type CookieConsentDecision = 'accept_all' | 'reject_all' | 'save'

export interface CookieConsentContextValue {
  mode: CookieNoticeMode
  activeCategories: readonly OptionalCookieCategory[]
  /** False during SSR and the first client render — nothing optional is decided before this. */
  ready: boolean
  flags: ConsentFlags
  bannerVisible: boolean
  preferencesOpen: boolean
  pending: boolean
  error: string | null
  openPreferences: () => void
  closePreferences: () => void
  acknowledgeNotice: () => void
  decide: (decision: CookieConsentDecision, flags?: ConsentFlags) => Promise<boolean>
}

export const CookieConsentContext = createContext<CookieConsentContextValue | null>(null)

export function useCookieConsent(): CookieConsentContextValue {
  const value = useContext(CookieConsentContext)
  if (!value) throw new Error('useCookieConsent must be used inside CookieConsentProvider')
  return value
}
