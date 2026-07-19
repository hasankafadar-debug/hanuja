import { Suspense } from 'react'
import { LoginPageClient } from './client-page'

export default function GirisPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const googleLoginEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

  return (
    <Suspense fallback={<div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 h-64" />}>
      <LoginPageClient turnstileSiteKey={turnstileSiteKey} googleLoginEnabled={googleLoginEnabled} />
    </Suspense>
  )
}
