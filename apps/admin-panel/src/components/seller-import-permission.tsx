'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button } from '@hanuja/ui'

interface Props {
  sellerId: string
  importEnabled: boolean
  importRequestedAt: string | null
}

export function SellerImportPermission({
  sellerId,
  importEnabled,
  importRequestedAt,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    if (!confirm('Bu satıcıya tek seferlik Hipicon import izni verilsin mi?')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/sellers/${sellerId}/import-permission`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        setError(body.message ?? body.error ?? 'İşlem başarısız.')
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  let statusBadge: React.ReactNode
  let statusDetail: React.ReactNode = null

  if (importEnabled) {
    statusBadge = <Badge variant="success">Aktif (kullanılmadı)</Badge>
    statusDetail = (
      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Satıcı tek bir commit yapana kadar izin geçerli kalır.
      </p>
    )
  } else if (importRequestedAt) {
    statusBadge = <Badge variant="warning">İstek Bekliyor</Badge>
    statusDetail = (
      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Talep tarihi:{' '}
        {new Date(importRequestedAt).toLocaleString('tr-TR', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    )
  } else {
    statusBadge = <Badge variant="secondary">İstek Yok</Badge>
  }

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
          Hipicon Import İzni
        </h3>
        {statusBadge}
      </div>
      <p className="text-sm mb-3" style={{ color: 'var(--color-muted-fg)' }}>
        Satıcı Hipicon mağaza URL&apos;si ile ürün çekmek için tek seferlik admin onayı
        ister. Onay verilince satıcı bir kez commit yapabilir; sonra izin otomatik
        tüketilir.
      </p>
      {statusDetail}
      {!importEnabled ? (
        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            onClick={approve}
            disabled={loading || !importRequestedAt}
          >
            {loading ? 'Onaylanıyor...' : 'İzni Onayla'}
          </Button>
          {!importRequestedAt ? (
            <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Onaylamak için önce satıcının izin istemesi gerekir.
            </span>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
