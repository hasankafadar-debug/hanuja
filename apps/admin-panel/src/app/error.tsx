'use client'

import { useEffect } from 'react'

function getFriendlyMessage(error: Error) {
  const message = error.message.toLowerCase()
  const isSchemaMismatch =
    message.includes('p2021') ||
    message.includes('p2022') ||
    message.includes('does not exist in the current database') ||
    message.includes('table') ||
    message.includes('column')

  if (isSchemaMismatch) {
    return 'Admin panel veritabani semasi uygulama ile uyumlu gorunmuyor. Lutfen migration adimlarini uygulayip sayfayi tekrar yukleyin.'
  }

  return 'Sayfa yuklenirken beklenmeyen bir hata meydana geldi. Lutfen tekrar deneyin.'
}

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
      <h2 className="mb-2 text-2xl font-semibold">Bir sorun oluştu</h2>
      <p className="mb-6 max-w-md text-muted-foreground">{getFriendlyMessage(error)}</p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Tekrar Dene
      </button>
    </div>
  )
}
