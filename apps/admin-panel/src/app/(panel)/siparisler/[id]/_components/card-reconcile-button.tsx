'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { getApiErrorMessage } from '@/lib/api-error'

interface Props {
  /** /api/admin/refunds/:id/reconcile veya /api/admin/card-reversals/:id/reconcile */
  endpoint: string
  label?: string
}

/**
 * Sonucu belirsiz kart iadesini / geri ödemesini iyzico raporuyla sonuçlandırır.
 * Yalnız raporda kanıtlanan sonuç uygulanır; para körlemesine yeniden gönderilmez.
 */
export function CardReconcileButton({ endpoint, label = 'iyzico ile mutabakat yap' }: Props) {
  const router = useRouter()
  const fieldId = useId()
  const submitting = useRef(false)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || reason.trim().length < 5) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      const response = await csrfFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(getApiErrorMessage(body, 'Mutabakat yapılamadı.'))
        return
      }
      const { data } = (await response.json()) as { data: { status: string } }
      setResult(`Mutabakat tamamlandı. Güncel durum: ${data.status}`)
      router.refresh()
    } catch {
      setError('Mutabakat yapılamadı. Bağlantınızı kontrol edin.')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting.current) return
        setOpen(next)
        if (!next) {
          setReason('')
          setError(null)
          setResult(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="mt-2">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>iyzico ile mutabakat</DialogTitle>
            <DialogDescription>
              iyzico ödeme raporu sorgulanır. İade veya iptal raporda görünüyorsa kayıt tamamlanır;
              görünmüyorsa ve yeterli süre geçtiyse yeniden denemeye alınır. İşlem denetim kaydına
              yazılır.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor={fieldId} className="mt-4 block text-sm font-medium">
            Gerekçe
          </label>
          <textarea
            id={fieldId}
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            rows={3}
            minLength={5}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          {error ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--color-destructive)' }}>
              {error}
            </p>
          ) : null}
          {result ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--color-success)' }}>
              {result}
            </p>
          ) : null}
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending || reason.trim().length < 5}>
              {pending ? 'Sorgulanıyor...' : 'Mutabakatı başlat'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
