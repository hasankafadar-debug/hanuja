'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@hanuja/ui'
import {
  COOKIE_CATEGORIES,
  COOKIE_CATEGORY_LABELS,
  type CookieCategory,
  type OptionalCookieCategory,
} from '@hanuja/api/lib/cookie-policy'
import { NO_OPTIONAL_CONSENT, type ConsentFlags } from '@/lib/cookie-consent/state'
import { useCookieConsent } from './context'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
const CHOICE_BUTTON = `rounded-full border border-primary bg-surface px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-muted disabled:cursor-wait ${FOCUS_RING}`

const INFO_PARAGRAPHS = [
  'Hanuja Dijital olarak internet sitemizin güvenli ve düzgün çalışmasını sağlamak, oturum yönetimini gerçekleştirmek ve talep ettiğiniz temel site işlevlerini sunmak amacıyla zorunlu çerezler kullanıyoruz.',
  'Bu çerezler sitenin çalışması için gerekli olup açık rızanıza tabi değildir. Şu anda analitik, kişiselleştirme veya reklam amaçlı zorunlu olmayan çerez kullanılmamaktadır.',
]

const CONSENT_PARAGRAPHS = [
  'Hanuja Dijital olarak internet sitemizin güvenli ve düzgün çalışması için zorunlu çerezler kullanıyoruz. Analitik, işlevsel ve reklam/pazarlama amaçlı zorunlu olmayan çerezler ise yalnızca tercihiniz doğrultusunda kullanılacaktır.',
  "Zorunlu olmayan çerezlere izin vermemeniz Hanuja'nın temel alışveriş işlevlerini kullanmanıza engel olmaz. Tercihlerinizi istediğiniz zaman değiştirebilirsiniz.",
]

function CategorySwitch({
  category,
  checked,
  disabled,
  onChange,
}: {
  category: OptionalCookieCategory
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`cookie-category-${category}-title`}
      aria-describedby={`cookie-category-${category}-description`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed ${
        checked ? 'border-primary bg-primary' : 'border-secondary bg-muted'
      } ${FOCUS_RING}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 rounded-full shadow transition-transform ${
          checked ? 'translate-x-[18px] bg-surface' : 'translate-x-[2px] bg-secondary'
        }`}
      />
    </button>
  )
}

/**
 * All four categories are always listed. Categories with no real cookie behind them are
 * shown switched off and locked, so the visitor never toggles a choice that does nothing.
 */
export function CookiePreferencesDialog() {
  const { mode, activeCategories, flags, preferencesOpen, pending, error, closePreferences, acknowledgeNotice, decide } =
    useCookieConsent()
  const [draft, setDraft] = useState<ConsentFlags>(NO_OPTIONAL_CONSENT)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Opened without a Radix trigger (footer, banner, policy page), so Radix has nowhere to
  // return focus to. Capture the opener before the dialog's focus trap moves focus.
  useLayoutEffect(() => {
    if (preferencesOpen && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement
    }
  }, [preferencesOpen])

  useEffect(() => {
    if (preferencesOpen) setDraft(flags)
  }, [preferencesOpen, flags])

  const isConsentMode = mode === 'consent'
  const paragraphs = isConsentMode ? CONSENT_PARAGRAPHS : INFO_PARAGRAPHS

  function renderControl(category: CookieCategory) {
    if (category === 'necessary') {
      return <span className="shrink-0 text-xs font-medium">Her Zaman Etkin</span>
    }
    const active = isConsentMode && activeCategories.includes(category)
    return (
      <CategorySwitch
        category={category}
        checked={active && draft[category]}
        disabled={!active || pending}
        onChange={(value) => setDraft((current) => ({ ...current, [category]: value }))}
      />
    )
  }

  return (
    <Dialog open={preferencesOpen} onOpenChange={(open) => (open ? undefined : closePreferences())}>
      <DialogContent
        className="max-h-[85vh] max-w-sm gap-3 overflow-y-auto bg-surface p-5 text-primary"
        onCloseAutoFocus={(event) => {
          const opener = returnFocusRef.current
          if (opener && opener.isConnected) {
            event.preventDefault()
            opener.focus()
          }
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="text-base">{isConsentMode ? 'Çerez Tercihleriniz' : 'Çerezler Hakkında'}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-xs leading-relaxed text-primary">
              {paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <p>
                Ayrıntılı bilgi için{' '}
                <Link
                  href="/cerez-politikasi"
                  onClick={closePreferences}
                  className={`underline underline-offset-2 ${FOCUS_RING}`}
                >
                  Çerez Aydınlatma Metni
                </Link>
                &apos;ni inceleyebilirsiniz.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-border border-y border-border">
          {COOKIE_CATEGORIES.map((category) => {
            const empty = category !== 'necessary' && !activeCategories.includes(category)
            return (
              <li key={category} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p id={`cookie-category-${category}-title`} className="text-sm font-medium">
                    {COOKIE_CATEGORY_LABELS[category].title}
                  </p>
                  <p id={`cookie-category-${category}-description`} className="mt-0.5 text-xs leading-relaxed">
                    {COOKIE_CATEGORY_LABELS[category].description}
                    {empty ? ' Bu kategoride şu anda çerez kullanılmıyor.' : ''}
                  </p>
                </div>
                {renderControl(category)}
              </li>
            )
          })}
        </ul>

        {error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}

        {isConsentMode ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-busy={pending}>
            <button type="button" disabled={pending} onClick={() => void decide('save', draft)} className={CHOICE_BUTTON}>
              Seçimlerimi Kaydet
            </button>
            <button type="button" disabled={pending} onClick={() => void decide('accept_all')} className={CHOICE_BUTTON}>
              Tümünü Kabul Et
            </button>
            <button type="button" disabled={pending} onClick={() => void decide('reject_all')} className={CHOICE_BUTTON}>
              Tümünü Reddet
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                acknowledgeNotice()
                closePreferences()
              }}
              className={`rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-fg ${FOCUS_RING}`}
            >
              Anladım
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
