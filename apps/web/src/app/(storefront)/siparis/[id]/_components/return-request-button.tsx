'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Textarea, useToast } from '@hanuja/ui'
import { RotateCcw } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'
import { ReturnPhotoPicker } from './return-photo-picker'

interface ReturnRequestButtonProps {
  orderId: string
}

function getApiMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null) {
    if ('message' in payload && typeof payload.message === 'string') return payload.message
    if ('error' in payload && typeof payload.error === 'string') return payload.error
  }
  return fallback
}

export default function ReturnRequestButton({ orderId }: ReturnRequestButtonProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [evidenceAssetIds, setEvidenceAssetIds] = useState<string[]>([])
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

    startTransition(async () => {
      const response = await csrfFetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          reason: reason.trim(),
          description: description.trim() || undefined,
          evidenceAssetIds: evidenceAssetIds.length ? evidenceAssetIds : undefined,
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
