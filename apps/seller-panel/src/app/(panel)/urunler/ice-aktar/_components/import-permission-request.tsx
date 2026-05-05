'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@hanuja/ui'

export function ImportPermissionRequest() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRequest() {
    startTransition(async () => {
      setError(null)
      try {
        const res = await fetch('/api/seller/products/import/request', {
          method: 'POST',
        })
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          setError(payload.error ?? 'İzin isteği gönderilemedi.')
          return
        }
        router.refresh()
      } catch {
        setError('Bağlantı hatası.')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import İzni Gerekli</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Hipicon mağaza URL&apos;si ile ürün içe aktarmak için tek seferlik admin onayı
          gerekir. İzin alındıktan sonra bir kez import yapabilirsiniz; tekrar kullanmak
          için yeniden istemeniz gerekir.
        </p>
        <Button type="button" onClick={handleRequest} disabled={isPending}>
          {isPending ? 'Gönderiliyor...' : 'İzin İste'}
        </Button>
        {error ? (
          <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ImportPermissionPending({ requestedAt }: { requestedAt: Date }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>İzin İsteğiniz İnceleniyor</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          {new Date(requestedAt).toLocaleString('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          tarihinde gönderilen import izin isteğiniz admin tarafından inceleniyor. Onay
          verildiğinde bu sayfada import formu görünecek.
        </p>
      </CardContent>
    </Card>
  )
}
