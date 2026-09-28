'use client'

import { useCookieConsent } from './context'

/** Permanent entry point for reviewing or withdrawing cookie choices (footer, cookie policy page). */
export function CookiePreferencesButton({
  className,
  children = 'Çerez Tercihleri',
}: {
  className?: string
  children?: React.ReactNode
}) {
  const { openPreferences } = useCookieConsent()
  return (
    <button type="button" onClick={openPreferences} className={className}>
      {children}
    </button>
  )
}
