import { Suspense } from 'react'
import { ResetPasswordPageClient } from './client-page'

export default function SifreSifirlaPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 h-64" />}>
      <ResetPasswordPageClient />
    </Suspense>
  )
}
