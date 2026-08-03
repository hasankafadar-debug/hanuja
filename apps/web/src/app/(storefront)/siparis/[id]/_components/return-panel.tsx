'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button, Input, Textarea, StatusBadge, useToast } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { ReturnPhotoPicker } from './return-photo-picker'

const STATUS_LABELS: Record<string, string> = {
  requested: 'Iade Talep Edildi - Tasarımcı kargo bilgisi bekleniyor',
  under_review: 'Inceleniyor',
  approved: 'Iade Onaylandi - Urunu kargoya verin',
  in_transit: 'Iade Kargoda - Tasarımcı onayı bekleniyor',
  received: 'Tasarımcı Teslim Aldı',
  rejected: 'Tasarımcı Reddetti - Uyuşmazlık İncelemesinde',
  refund_completed: 'Iade Tamamlandi',
}

interface Attachment {
  id: string
}

interface Message {
  id: string
  authorRole: 'customer' | 'seller' | 'admin'
  body: string
  createdAt: string
  attachments: Attachment[]
}

interface ReturnDetail {
  id: string
  status: string
  reason: string
  description: string | null
  sellerReturnAddress: string | null
  sellerReturnCargoCarrier: string | null
  sellerReturnInstructions: string | null
  returnCargoProvider: string | null
  returnTrackingNumber: string | null
  sellerRejectReason: string | null
  sellerRejectDescription: string | null
  evidence: Attachment[]
  messages: Message[]
  escalatedDispute: { status: string; resolution: string | null } | null
}

const ROLE_LABEL: Record<string, string> = {
  customer: 'Siz',
  seller: 'Tasarımcı',
  admin: 'Hanuja',
}

function privateMediaUrl(assetId: string) {
  return `/api/media/private/${encodeURIComponent(assetId)}`
}

export function ReturnPanel({ returnRequestId }: { returnRequestId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [data, setData] = useState<ReturnDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [barcodeIds, setBarcodeIds] = useState<string[]>([])

  const [reply, setReply] = useState('')
  const [replyAssetIds, setReplyAssetIds] = useState<string[]>([])
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    const res = await fetch(`/api/returns/${returnRequestId}`)
    if (res.ok) {
      const json = await res.json()
      setData(json.data as ReturnDetail)
    }
    setLoading(false)
  }, [returnRequestId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Iade detayi yukleniyor...
      </p>
    )
  }

  if (!data) return null

  const isClosed = data.status === 'refund_completed'
  const canShip = data.status === 'approved'

  function submitShipment() {
    if (carrier.trim().length < 2) {
      toast({ title: 'Kargo firmasi gerekli', variant: 'destructive' })
      return
    }

    if (!tracking.trim() && barcodeIds.length === 0) {
      toast({
        title: 'Kargo bilgisi gerekli',
        description: 'Takip numarasi girin veya kargo barkod gorseli yukleyin.',
        variant: 'destructive',
      })
      return
    }

    startTransition(async () => {
      const res = await csrfFetch(`/api/returns/${returnRequestId}/shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: carrier.trim(),
          trackingNumber: tracking.trim() || undefined,
          barcodeAssetId: barcodeIds[0],
        }),
      })

      if (!res.ok) {
        const p = await res.json().catch(() => null)
        toast({
          title: 'Gonderilemedi',
          description: (p?.message as string) ?? 'Tekrar deneyin.',
          variant: 'destructive',
        })
        return
      }

      toast({ title: 'Kargo bilgisi iletildi', variant: 'success' })
      await load()
      router.refresh()
    })
  }

  function submitReply() {
    if (reply.trim().length < 1) return

    startTransition(async () => {
      const res = await csrfFetch(`/api/returns/${returnRequestId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: reply.trim(),
          attachmentAssetIds: replyAssetIds.length ? replyAssetIds : undefined,
        }),
      })

      if (!res.ok) {
        const p = await res.json().catch(() => null)
        toast({
          title: 'Mesaj gonderilemedi',
          description: (p?.message as string) ?? 'Tekrar deneyin.',
          variant: 'destructive',
        })
        return
      }

      setReply('')
      setReplyAssetIds([])
      await load()
    })
  }

  return (
    <section
      className="mb-5 rounded-xl border p-5"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
          Iade Sureci
        </h2>
        <StatusBadge
          status={data.status as Parameters<typeof StatusBadge>[0]['status']}
          label={STATUS_LABELS[data.status] ?? data.status}
        />
      </div>

      <div className="mb-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        <p>
          <strong style={{ color: 'var(--color-primary)' }}>Sebep:</strong> {data.reason}
        </p>
        {data.description ? <p className="mt-1">{data.description}</p> : null}
      </div>

      {data.evidence.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.evidence.map((e) => {
            const imageUrl = privateMediaUrl(e.id)
            return (
              <a key={e.id} href={imageUrl} target="_blank" rel="noreferrer">
                <span
                  className="relative block h-16 w-16 overflow-hidden rounded-lg border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <Image
                    src={imageUrl}
                    alt="Iade gorseli"
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </span>
              </a>
            )
          })}
        </div>
      ) : null}

      {data.sellerReturnAddress ? (
        <div
          className="mb-4 rounded-lg border p-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-muted)',
          }}
        >
          <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
            Iade Kargo Bilgileri
          </p>
          <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
            <strong>Adres:</strong> {data.sellerReturnAddress}
          </p>
          {data.sellerReturnCargoCarrier ? (
            <p style={{ color: 'var(--color-muted-fg)' }}>
              <strong>Kargo:</strong> {data.sellerReturnCargoCarrier}
            </p>
          ) : null}
          {data.sellerReturnInstructions ? (
            <p style={{ color: 'var(--color-muted-fg)' }}>{data.sellerReturnInstructions}</p>
          ) : null}
        </div>
      ) : null}

      {data.sellerRejectReason ? (
        <div
          className="mb-4 rounded-lg border p-3 text-sm"
          style={{
            borderColor: 'var(--color-destructive, #dc2626)',
            backgroundColor: 'var(--color-destructive-muted, #fef2f2)',
          }}
        >
          <p className="font-medium" style={{ color: 'var(--color-destructive, #dc2626)' }}>
            Tasarımcı iadeyi reddetti
          </p>
          <p className="mt-1" style={{ color: 'var(--color-primary)' }}>
            {data.sellerRejectReason}
          </p>
          {data.sellerRejectDescription ? (
            <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
              {data.sellerRejectDescription}
            </p>
          ) : null}
          <p className="mt-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Konu Hanuja uyusmazlik ekibine iletildi. Asagidan yanit yazabilirsiniz.
          </p>
        </div>
      ) : null}

      {data.escalatedDispute?.resolution ? (
        <div
          className="mb-4 rounded-lg border p-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-muted)',
          }}
        >
          <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
            Uyusmazlik Sonucu
          </p>
          <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
            {data.escalatedDispute.resolution}
          </p>
        </div>
      ) : null}

      {canShip ? (
        <div
          className="mb-4 space-y-2 rounded-lg border p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            Urunu kargoya verdiniz mi? Kargo bilgilerini girin
          </p>
          <Input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="Kargo firmasi (orn. Yurtici)"
            disabled={pending}
          />
          <Input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="Kargo takip numarasi (opsiyonel)"
            disabled={pending}
          />
          <ReturnPhotoPicker
            onChange={setBarcodeIds}
            disabled={pending}
            label="Kargo barkod gorseli (takip numarasi yerine de kullanilabilir)"
          />
          <Button type="button" onClick={submitShipment} disabled={pending}>
            {pending ? 'Gonderiliyor...' : 'Kargoya Verdim'}
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Tasarımcı ile Yazışma
        </p>
        {data.messages.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Henuz mesaj yok.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.messages.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border p-3 text-sm"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                    {ROLE_LABEL[m.authorRole] ?? m.authorRole}
                  </span>
                  <span style={{ color: 'var(--color-muted-fg)' }}>
                    {new Date(m.createdAt).toLocaleString('tr-TR')}
                  </span>
                </div>
                <p style={{ color: 'var(--color-primary)' }}>{m.body}</p>
                {m.attachments.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.attachments.map((a) => {
                      const imageUrl = privateMediaUrl(a.id)
                      return (
                        <a key={a.id} href={imageUrl} target="_blank" rel="noreferrer">
                          <span
                            className="relative block h-14 w-14 overflow-hidden rounded border"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <Image
                              src={imageUrl}
                              alt="Ek"
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </span>
                        </a>
                      )
                    })}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {!isClosed ? (
          <div className="space-y-2">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Mesajiniz (telefon/e-posta paylasmayin)"
              rows={2}
              disabled={pending}
            />
            <ReturnPhotoPicker onChange={setReplyAssetIds} disabled={pending} />
            <Button type="button" variant="outline" onClick={submitReply} disabled={pending}>
              Mesaj Gonder
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
