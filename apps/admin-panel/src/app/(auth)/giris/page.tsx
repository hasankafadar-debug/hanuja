import { Suspense } from 'react'
import { AdminLoginPageClient } from './client-page'

export default function AdminGirisPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  return (
    <Suspense fallback={<div className="h-64 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm" />}>
      <AdminLoginPageClient turnstileSiteKey={turnstileSiteKey} />
    </Suspense>
  )
}
