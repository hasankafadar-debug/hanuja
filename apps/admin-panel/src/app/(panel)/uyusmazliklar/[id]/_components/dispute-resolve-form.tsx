'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Textarea, Input, useToast } from '@hanuja/ui'
import { AlertTriangle } from 'lucide-react'

interface Props {
  disputeId: string
  /** When set, the conversation lives on the linked return thread. */
  returnRequestId: string | null
  canResolve: boolean
}

export function DisputeResolveForm({ disputeId, returnRequestId, canResolve }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState('')
  const [refund, setRefund] = useState('')

  function sendNote() {
    if (note.trim().length < 1) return
    const url = returnRequestId
      ? `/api/admin/returns/${returnRequestId}/messages`
      : `/api/admin/disputes/${disputeId}/messages`
    startTransition(async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: note.trim() }),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => null)
        toast({ title: 'Not eklenemedi', description: (p?.message as string) ?? 'Tekrar deneyin.', variant: 'destructive' })
        return
      }
      setNote('')
      toast({ title: 'Not eklendi', variant: 'success' })
      router.refresh()
    })
  }

  function resolve(resolutionType: 'resolved_for_customer' | 'resolved_for_seller') {
    if (resolution.trim().length < 5) {
      toast({ title: 'Sonuç açıklaması en az 5 karakter olmalı', variant: 'destructive' })
      return
    }
    startTransition(async () => {
      const body: Record<string, unknown> = {
        resolutionType,
        resolution: resolution.trim(),
      }
      const refundNum = Number(refund)
      if (resolutionType === 'resolved_for_customer' && refund.trim() && refundNum > 0) {
        body.refundAmount = refundNum
      }
      const res = await fetch(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => null)
        toast({ title: 'Çözülemedi', description: (p?.message as string) ?? 'Tekrar deneyin.', variant: 'destructive' })
        return
      }
      toast({ title: 'Uyuşmazlık kapatıldı', variant: 'success' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div
        className="rounded-xl border p-5 space-y-2"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Not / Mesaj Ekle {returnRequestId ? '(müşteri-satıcı yazışmasına yazılır)' : ''}
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Tarafların göreceği not"
          rows={2}
          disabled={pending}
        />
        <Button type="button" variant="outline" size="sm" onClick={sendNote} disabled={pending}>
          Not Ekle
        </Button>
      </div>

      {canResolve ? (
        <div
          className="rounded-xl border p-5 space-y-3"
          style={{ borderColor: 'var(--color-warning)', backgroundColor: '#fffbeb' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
            <span className="text-sm font-semibold" style={{ color: '#92400e' }}>
              Uyuşmazlığı Kapat
            </span>
          </div>
          <p className="text-xs" style={{ color: '#92400e' }}>
            Bu işlem geri alınamaz. Müşteri lehine çözümde (tutar girilirse) para iadesi başlatılır ve
            hakediş bloke kalır. Satıcı lehine çözümde hakediş serbest kalır.
          </p>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Sonuç açıklaması (zorunlu, en az 5 karakter)"
            rows={3}
            disabled={pending}
          />
          <Input
            value={refund}
            onChange={(e) => setRefund(e.target.value)}
            placeholder="İade tutarı (TRY) — müşteri lehine ve gerekiyorsa"
            inputMode="decimal"
            disabled={pending}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => resolve('resolved_for_customer')}
            >
              Müşteri Lehine Kapat
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => resolve('resolved_for_seller')}
            >
              Satıcı Lehine Kapat
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
