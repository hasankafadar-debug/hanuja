'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  FileUpload,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  type UploadedAsset,
} from '@hanuja/ui'

interface OrderOption {
  id: string
  label: string
}

export function NewTicketForm({ orders }: { orders: OrderOption[] }) {
  const router = useRouter()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<UploadedAsset[]>([])
  const [orderId, setOrderId] = useState('__general__')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      setError(null)

      const response = await fetch('/api/seller/support-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body: message,
          orderId: orderId === '__general__' ? null : orderId,
          attachmentAssetIds: attachments.map((asset) => asset.id),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string
        error?: string
        data?: { ticket?: { id: string } }
      }

      if (!response.ok) {
        setError(payload.message ?? payload.error ?? 'Destek talebi oluşturulamadı.')
        return
      }

      const ticketId = payload.data?.ticket?.id
      if (ticketId) {
        router.push(`/destek/${ticketId}`)
        router.refresh()
        return
      }

      router.refresh()
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
          Yeni Destek Talebi
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Genel bir konu açabilir veya talebi belirli bir siparişe bağlayabilirsiniz.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="support-subject">Konu</Label>
          <Input
            id="support-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Örneğin: Ürün aktarımında hata alıyorum"
            disabled={isPending}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="support-order">Sipariş Bağlantısı</Label>
          <Select value={orderId} onValueChange={setOrderId}>
            <SelectTrigger id="support-order" aria-label="Sipariş bağlantısı" disabled={isPending}>
              <SelectValue placeholder="Genel destek talebi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__general__">Genel destek talebi</SelectItem>
              {orders.map((order) => (
                <SelectItem key={order.id} value={order.id}>
                  {order.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="support-message">Mesaj</Label>
        <Textarea
          id="support-message"
          rows={5}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Sorunu veya ihtiyacınızı mümkün olduğunca detaylı anlatın."
          disabled={isPending}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label>Dosya Eki</Label>
        <FileUpload
          folder="documents"
          maxFiles={5}
          value={attachments}
          onChange={setAttachments}
          disabled={isPending}
          showPreviews={false}
          inputLabel="Destek dosyası yükle"
        />
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Gönderiliyor...' : 'Destek Talebi Başlat'}
        </Button>
      </div>
    </form>
  )
}
