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
  Input,
} from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { getApiErrorMessage } from '@/lib/api-error'
import { formatRefundOutstandingAmount } from '@/lib/admin-refund-presentation'

interface Props {
  refundId: string
  orderId: string
  orderLabel: string
  customerName: string
  currency: string
  outstandingAmount: string | null
  blockedReason: string | null
}

export function ManualRefundCompletion(props: Props) {
  const router = useRouter()
  const fieldId = useId()
  const submitting = useRef(false)
  const [open, setOpen] = useState(false)
  const [reference, setReference] = useState('')
  const [paymentMade, setPaymentMade] = useState(false)
  const [pending, setPending] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountLabel = formatRefundOutstandingAmount(props.outstandingAmount, props.currency)

  function changeOpen(nextOpen: boolean) {
    if (submitting.current) return
    setOpen(nextOpen)
    if (!nextOpen) {
      setReference('')
      setPaymentMade(false)
      setError(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || completed || props.blockedReason || !props.outstandingAmount) return
    if (!paymentMade || reference.trim().length < 3 || reference.trim().length > 200) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      const response = await csrfFetch(`/api/admin/refunds/${props.refundId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: props.orderId,
          providerReference: reference.trim(),
          expectedOutstandingAmount: props.outstandingAmount,
          paymentMade: true,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setError(
          getApiErrorMessage(
            payload,
            'İade onayı kaydedilemedi. Sayfayı yenileyip durumu kontrol edin.',
          ),
        )
        return
      }
      if (payload?.data?.id !== props.refundId || payload?.data?.status !== 'completed') {
        setError(
          'İade sonucu doğrulanamadı. Yeniden ödeme yapmayın; sayfayı yenileyip kaydı kontrol edin.',
        )
        return
      }
      setCompleted(true)
      setOpen(false)
      router.refresh()
    } catch {
      setError(
        'Bağlantı nedeniyle sonuç doğrulanamadı. Yeniden para göndermeyin. Sayfayı yenileyip kaydı kontrol edin; gerekirse aynı referansla tekrar onaylayın.',
      )
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  if (completed) {
    return (
      <p role="status" className="mt-3 text-sm text-green-800">
        İade ödemesi kaydedildi. Bu kayıt bekleyen iadelerden çıkarıldı.
      </p>
    )
  }
  if (props.blockedReason) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        {props.blockedReason}
      </p>
    )
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
      <p className="text-sm font-semibold">Ödenecek kalan tutar: {amountLabel}</p>
      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Bankadan iadeyi yaptıktan sonra yalnızca bu kaydın ödemesini onaylayın.
      </p>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            İade ödeme yapıldı
          </Button>
        </DialogTrigger>
        <DialogContent
          className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto"
          hideClose={pending}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>İade ödemesini onayla</DialogTitle>
            <DialogDescription>
              Bu işlem para göndermez. Bankadan yaptığınız EFT/havale iadesini sisteme kaydeder ve
              bu iade kaydını bekleyen listesinden çıkarır.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
            <dl
              className="space-y-2 rounded-lg border p-3 text-sm"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div>
                <dt className="text-xs text-muted-fg">Sipariş / müşteri</dt>
                <dd className="break-words">
                  {props.orderLabel} · {props.customerName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-fg">İade kaydı</dt>
                <dd className="break-all text-xs">{props.refundId}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-fg">Bu kayıt için ödenen tutar</dt>
                <dd className="text-lg font-semibold">{amountLabel}</dd>
              </div>
            </dl>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-reference`} className="text-sm font-medium">
                Banka işlem / dekont referansı
              </label>
              <Input
                id={`${fieldId}-reference`}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                required
                minLength={3}
                maxLength={200}
                disabled={pending}
                autoComplete="off"
                aria-describedby={`${fieldId}-reference-help`}
              />
              <p id={`${fieldId}-reference-help`} className="text-xs text-muted-fg">
                Yalnızca işlem referansını yazın; IBAN veya kart bilgisi girmeyin.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={paymentMade}
                onChange={(event) => setPaymentMade(event.target.checked)}
                required
                disabled={pending}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span>
                {amountLabel} tutarındaki iadeyi müşteriye bankadan yaptım ve dekontunu kontrol
                ettim.
              </span>
            </label>
            {error ? (
              <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => changeOpen(false)}
              >
                Vazgeç
              </Button>
              <Button
                type="submit"
                disabled={pending || !paymentMade || reference.trim().length < 3}
              >
                {pending ? 'Kaydediliyor…' : 'Ödemeyi kaydet'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
