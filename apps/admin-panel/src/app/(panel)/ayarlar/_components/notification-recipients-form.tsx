'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

export interface RecipientRow {
  event: string
  label: string
  email: string
}

interface Props {
  initialRecipients: RecipientRow[]
}

export function NotificationRecipientsForm({ initialRecipients }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialRecipients.map((row) => [row.event, row.email])),
  )
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setLoading(true)
    setMessage(null)
    setError(null)

    try {
      const response = await csrfFetch('/api/admin/notification-recipients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: initialRecipients.map((row) => ({
            event: row.event,
            email: (values[row.event] ?? '').trim(),
          })),
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(payload.error ?? 'Alıcılar kaydedilemedi.')
        return
      }

      setMessage('Bildirim alıcıları kaydedildi.')
      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {initialRecipients.map((row) => (
          <div key={row.event} className="space-y-1.5">
            <Label htmlFor={`recipient-${row.event}`}>{row.label}</Label>
            <Input
              id={`recipient-${row.event}`}
              type="email"
              value={values[row.event] ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, [row.event]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>

      {message ? (
        <p className="text-sm" style={{ color: 'var(--color-success)' }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}

      <Button onClick={save} disabled={loading}>
        {loading ? 'Kaydediliyor...' : 'Alıcıları Kaydet'}
      </Button>
    </div>
  )
}
