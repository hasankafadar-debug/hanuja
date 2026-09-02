'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Textarea, useToast } from '@hanuja/ui'
import { RotateCcw } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'
import { ReturnPhotoPicker } from './return-photo-picker'

interface ReturnRequestButtonProps {
  orderId: string
  lines?: Array<{
    id: string
    name: string
    availableQuantity: number
  }>
}

function getApiMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null) {
    if ('message' in payload && typeof payload.message === 'string') return payload.message
    if ('error' in payload && typeof payload.error === 'string') return payload.error
  }
  return fallback
}

export default function ReturnRequestButton({ orderId, lines }: ReturnRequestButtonProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [evidenceAssetIds, setEvidenceAssetIds] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const idempotencyKey = useRef<string>(crypto.randomUUID())
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (reason.trim().length < 3) {
      toast({
        title: 'İade talebi oluşturulamadı',
        description: 'Lütfen en az 3 karakterlik bir sebep yazın.',
        variant: 'destructive',
      })
      return
    }
    const items = lines
      ?.map((line) => ({ orderLineId: line.id, quantity: quantities[line.id] ?? 0 }))
      .filter((item) => item.quantity > 0)
    if (lines && (!items || items.length === 0)) {
      toast({
        title: 'İade talebi oluşturulamadı',
        description: 'İade etmek istediğiniz en az bir ürün seçin.',
        variant: 'destructive',
      })
      return
    }

    startTransition(async () => {
      const response = await csrfFetch('/api/returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(lines ? { 'Idempotency-Key': idempotencyKey.current } : {}),
        },
        body: JSON.stringify({
          orderId,
          reason: reason.trim(),
          description: description.trim() || undefined,
          evidenceAssetIds: evidenceAssetIds.length ? evidenceAssetIds : undefined,
          ...(lines ? { items } : {}),
        }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        toast({
          title: 'İade talebi oluşturulamadı',
          description: getApiMessage(payload, 'Lütfen tekrar deneyin.'),
          variant: 'destructive',
        })
        return
      }

      idempotencyKey.current = crypto.randomUUID()
      setQuantities({})
      setReason('')
      setDescription('')
      setEvidenceAssetIds([])
      setOpen(false)
      toast({
        title: 'İade talebi alındı',
        description: 'Tasarımcı iade kargo bilgilerini iletene kadar bekleyin.',
        variant: 'success',
      })
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4" />
        İade Talebi Oluştur
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
      {lines ? (
        <div>
          <p className="mb-2 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            İade edilecek ürün ve adetler
          </p>
          <div className="divide-y rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
            {lines.map((line) => {
              const selected = (quantities[line.id] ?? 0) > 0
              return (
                <div key={line.id} className="flex items-center gap-3 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [line.id]: event.target.checked ? 1 : 0,
                      }))
                    }
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1 text-sm font-medium">{line.name}</span>
                  <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Adet
                    <input
                      type="number"
                      min={1}
                      max={line.availableQuantity}
                      disabled={!selected}
                      value={selected ? quantities[line.id] : 1}
                      onChange={(event) => {
                        const quantity = Math.max(
                          1,
                          Math.min(line.availableQuantity, Number(event.target.value) || 1),
                        )
                        setQuantities((current) => ({ ...current, [line.id]: quantity }))
                      }}
                      className="h-9 w-16 rounded-md border bg-transparent px-2 text-center text-sm disabled:opacity-40"
                      style={{ borderColor: 'var(--color-border)' }}
                    />
                    / {line.availableQuantity}
                  </label>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="İade sebebi"
        disabled={isPending}
      />
      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Açıklama (isteğe bağlı)"
        rows={3}
        disabled={isPending}
      />
      <ReturnPhotoPicker
        onChange={setEvidenceAssetIds}
        disabled={isPending}
        label="Ürün görselleri (isteğe bağlı)"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={submit} disabled={isPending}>
          {isPending ? 'Gönderiliyor...' : 'Talebi Gönder'}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
          Vazgeç
        </Button>
      </div>
    </div>
  )
}
