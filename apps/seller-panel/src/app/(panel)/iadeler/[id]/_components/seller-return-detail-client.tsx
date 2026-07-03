'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button, Input, Textarea, StatusBadge, normalizeMediaDisplayUrl, useToast } from '@hanuja/ui'
import { Paperclip, X } from 'lucide-react'
import { uploadSellerReturnPhoto, ACCEPTED_MIME, MAX_FILES } from './seller-return-photo'

interface Attachment {
  id: string
  url: string
}
interface Message {
  id: string
  authorRole: string
  body: string
  createdAt: string
  attachments: Attachment[]
}
export interface SellerReturnData {
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
  evidence: Attachment[]
  messages: Message[]
  disputeStatus: string | null
  orderNumber: string
  productNames: string[]
}

const STATUS_LABELS: Record<string, string> = {
  requested: 'İade Talebi — Kargo bilgisi girin',
  under_review: 'İnceleniyor',
  approved: 'Müşterinin kargoya vermesi bekleniyor',
  in_transit: 'Kargoda — Teslim alıp onaylayın/reddedin',
  received: 'Teslim Alındı',
  rejected: 'Reddedildi — Uyuşmazlığa taşındı',
  refund_completed: 'İade Tamamlandı',
}
const ROLE_LABEL: Record<string, string> = {
  customer: 'Müşteri',
  seller: 'Siz',
  admin: 'Hanuja',
}

function usePhotos() {
  const [ids, setIds] = useState<string[]>([])
  const [names, setNames] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) {
      if (names.length >= MAX_FILES) break
      if (!ACCEPTED_MIME.includes(file.type)) continue
      setNames((p) => [...p, file.name])
      uploadSellerReturnPhoto(file)
        .then((id) => setIds((p) => [...p, id]))
        .catch(() => setNames((p) => p.filter((n) => n !== file.name)))
    }
  }
  function reset() {
    setIds([])
    setNames([])
  }
  const node = (
    <div>
      {names.length > 0 ? (
        <ul className="mb-2 space-y-1 text-xs">
          {names.map((n, i) => (
            <li key={i} className="flex items-center gap-2" style={{ color: 'var(--color-muted-fg)' }}>
              {n} {ids[i] ? '— hazır' : '— yükleniyor...'}
              <button type="button" onClick={() => { setNames((p) => p.filter((_, x) => x !== i)); setIds((p) => p.filter((_, x) => x !== i)) }}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input ref={inputRef} type="file" multiple accept={ACCEPTED_MIME.join(',')} onChange={pick} className="sr-only" />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <Paperclip className="h-4 w-4" /> Görsel Ekle
      </Button>
    </div>
  )
  return { ids, node, reset }
}

export function SellerReturnDetailClient({ data }: { data: SellerReturnData }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  const [address, setAddress] = useState('')
  const [carrier, setCarrier] = useState('')
  const [instructions, setInstructions] = useState('')

  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectDesc, setRejectDesc] = useState('')
  const rejectPhotos = usePhotos()

  const [reply, setReply] = useState('')
  const replyPhotos = usePhotos()

  function post(url: string, body: unknown, okMsg: string) {
    startTransition(async () => {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
      if (body) init.body = JSON.stringify(body)
      const res = await fetch(url, init)
      if (!res.ok) {
        const p = await res.json().catch(() => null)
        toast({ title: 'İşlem başarısız', description: (p?.message as string) ?? 'Tekrar deneyin.', variant: 'destructive' })
        return
      }
      toast({ title: okMsg, variant: 'success' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
          İade #{data.id.slice(-8).toUpperCase()} — Sipariş {data.orderNumber}
        </h1>
        <StatusBadge
          status={data.status as Parameters<typeof StatusBadge>[0]['status']}
          label={STATUS_LABELS[data.status] ?? data.status}
        />
      </div>

      <section className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <p style={{ color: 'var(--color-muted-fg)' }}>
          <strong style={{ color: 'var(--color-primary)' }}>Ürün(ler):</strong> {data.productNames.join(', ')}
        </p>
        <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
          <strong style={{ color: 'var(--color-primary)' }}>Müşteri sebebi:</strong> {data.reason}
        </p>
        {data.description ? <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>{data.description}</p> : null}
        {data.evidence.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {data.evidence.map((e) => (
              <a key={e.id} href={e.url} target="_blank" rel="noreferrer">
                <span className="relative block h-16 w-16 overflow-hidden rounded border" style={{ borderColor: 'var(--color-border)' }}>
                  <Image src={normalizeMediaDisplayUrl(e.url)} alt="Görsel" fill className="object-cover" />
                </span>
              </a>
            ))}
          </div>
        ) : null}
        {data.returnTrackingNumber || data.returnCargoProvider ? (
          <p className="mt-2" style={{ color: 'var(--color-muted-fg)' }}>
            <strong style={{ color: 'var(--color-primary)' }}>Müşteri kargosu:</strong>{' '}
            {data.returnCargoProvider} {data.returnTrackingNumber}
          </p>
        ) : null}
      </section>

      {data.status === 'requested' || data.status === 'under_review' ? (
        <section className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>İade Kargo Bilgisi Gir</p>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="İade adresi" rows={2} disabled={pending} />
          <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Kargo firması (anlaşmalı kod vb.)" disabled={pending} />
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Talimat (opsiyonel)" rows={2} disabled={pending} />
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              post(`/api/seller/returns/${data.id}/cargo-info`, {
                address: address.trim(),
                carrier: carrier.trim(),
                instructions: instructions.trim() || undefined,
              }, 'İade kargo bilgisi iletildi')
            }
          >
            Kargo Bilgisini Gönder
          </Button>
        </section>
      ) : null}

      {data.status === 'in_transit' ? (
        <section className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            Ürün size ulaştı mı?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => post(`/api/seller/returns/${data.id}/confirm-receipt`, null, 'İade onaylandı, müşteriye iade başlatıldı')}
            >
              Kargoyu Aldım / Onayla
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setRejectOpen((v) => !v)}>
              Reddet (Yanlış Ürün)
            </Button>
          </div>
          {rejectOpen ? (
            <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--color-destructive, #dc2626)' }}>
              <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Red sebebi" disabled={pending} />
              <Textarea value={rejectDesc} onChange={(e) => setRejectDesc(e.target.value)} placeholder="Açıklama" rows={2} disabled={pending} />
              {rejectPhotos.node}
              <Button
                type="button"
                variant="outline"
                disabled={pending || rejectReason.trim().length < 1}
                onClick={() =>
                  post(`/api/seller/returns/${data.id}/reject`, {
                    reason: rejectReason.trim(),
                    description: rejectDesc.trim() || undefined,
                    evidenceAssetIds: rejectPhotos.ids.length ? rejectPhotos.ids : undefined,
                  }, 'İade reddedildi, uyuşmazlığa taşındı')
                }
              >
                Reddi Gönder
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {data.sellerRejectReason ? (
        <section className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
          <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
            Reddedildi — Uyuşmazlık {data.disputeStatus ? `(${data.disputeStatus})` : ''}
          </p>
          <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>{data.sellerRejectReason}</p>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>Müşteri ile Yazışma</p>
        {data.messages.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>Henüz mesaj yok.</p>
        ) : (
          <ul className="space-y-2">
            {data.messages.map((m) => (
              <li key={m.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: 'var(--color-primary)' }}>{ROLE_LABEL[m.authorRole] ?? m.authorRole}</span>
                  <span style={{ color: 'var(--color-muted-fg)' }}>{new Date(m.createdAt).toLocaleString('tr-TR')}</span>
                </div>
                <p style={{ color: 'var(--color-primary)' }}>{m.body}</p>
                {m.attachments.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.attachments.map((a) => (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                        <span className="relative block h-14 w-14 overflow-hidden rounded border" style={{ borderColor: 'var(--color-border)' }}>
                          <Image src={normalizeMediaDisplayUrl(a.url)} alt="Ek" fill className="object-cover" />
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.status !== 'refund_completed' ? (
          <div className="space-y-2">
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Mesaj (telefon/e-posta paylaşmayın)" rows={2} disabled={pending} />
            {replyPhotos.node}
            <Button
              type="button"
              variant="outline"
              disabled={pending || reply.trim().length < 1}
              onClick={() =>
                post(`/api/seller/returns/${data.id}/messages`, {
                  body: reply.trim(),
                  attachmentAssetIds: replyPhotos.ids.length ? replyPhotos.ids : undefined,
                }, 'Mesaj gönderildi')
              }
            >
              Mesaj Gönder
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
