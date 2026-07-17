import { Suspense } from 'react'
import { AdminResetPasswordPageClient } from './client-page'

export default function AdminResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="h-80 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm" />
      }
    >
      <AdminResetPasswordPageClient />
    </Suspense>
  )
}
