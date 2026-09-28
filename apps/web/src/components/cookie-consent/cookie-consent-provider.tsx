'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  COOKIE_POLICY_VERSION,
  getActiveOptionalCategories,
  getCookieNoticeMode,
  OPTIONAL_COOKIE_CATEGORIES,
} from '@hanuja/api/lib/cookie-policy'
import { csrfFetch } from '@/lib/csrf-fetch'
import {
  NO_OPTIONAL_CONSENT,
  toConsentFlags,
  type ConsentFlags,
  type StoredConsent,
} from '@/lib/cookie-consent/state'
import { computeWithdrawalCleanup, resolveScriptsToLoad } from '@/lib/cookie-consent/scripts'
import {
  applyWithdrawalCleanup,
  injectConsentScript,
  readNoticeAcknowledged,
  readStoredConsent,
  writeNoticeAcknowledged,
  writeStoredConsent,
} from '@/lib/cookie-consent/browser'
import { CookieConsentContext, type CookieConsentContextValue, type CookieConsentDecision } from './context'
import { CookieBanner } from './cookie-banner'
import { CookiePreferencesDialog } from './cookie-preferences-dialog'

const SAVE_FAILED_MESSAGE = 'Tercihiniz kaydedilemedi. Lütfen tekrar deneyin.'

interface RecordResponse {
  consentId: string
  functional: boolean
  analytics: boolean
  marketing: boolean
}

function flagsForDecision(
  decision: CookieConsentDecision,
  requested: ConsentFlags,
  active: readonly string[],
): ConsentFlags {
  const flags = { ...NO_OPTIONAL_CONSENT }
  for (const category of OPTIONAL_COOKIE_CATEGORIES) {
    if (!active.includes(category)) continue
    flags[category] = decision === 'accept_all' ? true : decision === 'reject_all' ? false : requested[category]
  }
  return flags
}

/**
 * Mounted once in the root layout. Nothing optional runs before the stored decision is
 * read after hydration, and nothing optional runs at all without a recorded grant.
 * Scrolling, navigating or closing a dialog never counts as consent.
 */
export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const mode = getCookieNoticeMode()
  const activeCategories = useMemo(() => getActiveOptionalCategories(), [])
  const [ready, setReady] = useState(false)
  const [consent, setConsent] = useState<StoredConsent | null>(null)
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedScripts = useRef(new Set<string>())

  useEffect(() => {
    setConsent(readStoredConsent())
    setNoticeAcknowledged(readNoticeAcknowledged())
    setReady(true)
  }, [])

  const flags = useMemo(() => toConsentFlags(consent), [consent])

  useEffect(() => {
    if (!ready) return
    for (const script of resolveScriptsToLoad(flags)) {
      if (loadedScripts.current.has(script.id)) continue
      injectConsentScript(script)
      loadedScripts.current.add(script.id)
    }
  }, [ready, flags])

  const acknowledgeNotice = useCallback(() => {
    writeNoticeAcknowledged()
    setNoticeAcknowledged(true)
  }, [])

  const decide = useCallback<CookieConsentContextValue['decide']>(
    async (decision, requested = NO_OPTIONAL_CONSENT) => {
      if (mode !== 'consent') return false
      const next = flagsForDecision(decision, requested, activeCategories)
      setPending(true)
      setError(null)

      let applied: ConsentFlags = next
      let consentId = consent?.consentId ?? null
      let recorded = false
      try {
        const response = await csrfFetch('/api/cookie-consent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision, consentId, policyVersion: COOKIE_POLICY_VERSION, ...next }),
        })
        if (response.ok) {
          const body = (await response.json()) as RecordResponse
          consentId = body.consentId
          applied = { functional: body.functional, analytics: body.analytics, marketing: body.marketing }
          recorded = true
        }
      } catch {
        recorded = false
      }

      // Fail closed: a grant without a stored proof is not applied. A refusal is always
      // honoured locally, even if it could not be recorded.
      if (!recorded && OPTIONAL_COOKIE_CATEGORIES.some((category) => next[category])) {
        setError(SAVE_FAILED_MESSAGE)
        setPending(false)
        return false
      }

      const cleanup = computeWithdrawalCleanup(flags, applied)
      applyWithdrawalCleanup(cleanup)
      const stored: StoredConsent = {
        consentId,
        policyVersion: COOKIE_POLICY_VERSION,
        ...applied,
        decidedAt: new Date().toISOString(),
      }
      writeStoredConsent(stored)

      // A script that already ran cannot be unloaded; a reload guarantees it stops.
      if (cleanup.scriptIds.some((id) => loadedScripts.current.has(id))) {
        window.location.reload()
        return true
      }

      setConsent(stored)
      setPreferencesOpen(false)
      setPending(false)
      return true
    },
    [mode, activeCategories, consent, flags],
  )

  const bannerVisible =
    ready && !preferencesOpen && (mode === 'info' ? !noticeAcknowledged : consent === null)

  const value = useMemo<CookieConsentContextValue>(
    () => ({
      mode,
      activeCategories,
      ready,
      flags,
      bannerVisible,
      preferencesOpen,
      pending,
      error,
      openPreferences: () => {
        setError(null)
        setPreferencesOpen(true)
      },
      closePreferences: () => setPreferencesOpen(false),
      acknowledgeNotice,
      decide,
    }),
    [mode, activeCategories, ready, flags, bannerVisible, preferencesOpen, pending, error, acknowledgeNotice, decide],
  )

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
      <CookieBanner />
      <CookiePreferencesDialog />
    </CookieConsentContext.Provider>
  )
}
