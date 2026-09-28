'use client'

import Link from 'next/link'
import { Cookie } from 'lucide-react'
import type { OptionalCookieCategory } from '@hanuja/api/lib/cookie-policy'
import { useCookieConsent } from './context'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'

/** Same size, colour and weight for accept, reject and manage (KVKK cookie guideline). */
const CONSENT_CHOICE_BUTTON_CLASS = `rounded-full border border-primary bg-surface px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-muted disabled:cursor-wait ${FOCUS_RING}`

function PolicyLink() {
  return (
    <Link href="/cerez-politikasi" className={`underline underline-offset-2 ${FOCUS_RING}`}>
      Ayrıntılar<span className="sr-only"> (Çerez Aydınlatma Metni)</span>
    </Link>
  )
}

const CATEGORY_WORDS: Record<OptionalCookieCategory, string> = {
  functional: 'işlevsel',
  analytics: 'analitik',
  marketing: 'pazarlama',
}

function joinTurkish(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} ve ${words[words.length - 1]}`
}

/**
 * Compact floating notice at the bottom centre ("küçük baloncuk", design C).
 * It never blocks the page. Info mode only acknowledges the notice; consent mode offers
 * three equal choices. There is no close icon: dismissing is not a decision.
 */
export function CookieBanner() {
  const { mode, activeCategories, bannerVisible, pending, error, acknowledgeNotice, decide, openPreferences } =
    useCookieConsent()
  if (!bannerVisible) return null

  if (mode === 'info') {
    return (
      <div
        role="region"
        aria-label="Çerez bildirimi"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex justify-center"
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-[20px] border border-border bg-surface py-1.5 pl-3.5 pr-1.5 text-xs text-primary shadow-md">
          <Cookie className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Yalnızca zorunlu çerezler<span className="hidden sm:inline"> kullanıyoruz</span> · <PolicyLink />
          </p>
          <button
            type="button"
            onClick={acknowledgeNotice}
            className={`shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-fg ${FOCUS_RING}`}
          >
            Anladım
          </button>
        </div>
      </div>
    )
  }

  const categoryWords = activeCategories.map((category) => CATEGORY_WORDS[category])
  const sentence = `${joinTurkish(categoryWords)} çerezleri yalnızca izninizle.`

  return (
    <div
      role="region"
      aria-label="Çerez tercihleriniz"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex justify-center"
    >
      <div
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border bg-surface px-3 py-2.5 text-center text-xs text-primary shadow-md"
        aria-busy={pending}
      >
        <p>
          {sentence.charAt(0).toLocaleUpperCase('tr-TR') + sentence.slice(1)} <PolicyLink />
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            aria-label="Tümünü kabul et"
            disabled={pending}
            onClick={() => void decide('accept_all')}
            className={CONSENT_CHOICE_BUTTON_CLASS}
          >
            Kabul et
          </button>
          <button
            type="button"
            aria-label="Tümünü reddet"
            disabled={pending}
            onClick={() => void decide('reject_all')}
            className={CONSENT_CHOICE_BUTTON_CLASS}
          >
            Reddet
          </button>
          <button
            type="button"
            aria-label="Tercihleri yönet"
            disabled={pending}
            onClick={openPreferences}
            className={CONSENT_CHOICE_BUTTON_CLASS}
          >
            Yönet
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-1.5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
