'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Admin panel error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-2xl font-semibold mb-2">Bir sorun oluştu</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        Sayfa yüklenirken beklenmeyen bir hata meydana geldi. Lütfen tekrar deneyin.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Tekrar Dene
      </button>
    </div>
  )
}
