import { Suspense } from 'react'
import { SellerLoginPageClient } from './client-page'

export default function GirisPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  return (
    <Suspense fallback={<div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 h-64" />}>
      <SellerLoginPageClient turnstileSiteKey={turnstileSiteKey} />
    </Suspense>
  )
}
