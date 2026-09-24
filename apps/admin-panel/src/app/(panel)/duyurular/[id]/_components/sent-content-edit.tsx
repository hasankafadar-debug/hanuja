'use client'

import { useState } from 'react'
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '@hanuja/api/domain/announcement-audience'
import { Button, Input, Label, Textarea } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { readApiData, readApiError } from '../../_components/api'

interface SentContentEditProps {
  announcementId: string
  version: number
  title: string
  body: string
  onSaved: (next: { version: number; title: string; body: string; changed: boolean }) => void
}

export function SentContentEdit({ announcementId, version, title, body, onSaved }: SentContentEditProps) {
  const [open, setOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const [draftBody, setDraftBody] = useState(body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    // The fields are locked while saving; the values sent are what the page reports as saved.
    const sentTitle = draftTitle
    const sentBody = draftBody
    try {
      const response = await csrfFetch(`/api/admin/announcements/${announcementId}/sent-content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, title: sentTitle, body: sentBody }),
      })
      if (!response.ok) {
        setError(await readApiError(response, 'Değişiklikler kaydedilemedi.'))
        return
      }
      const data = await readApiData<{ version: number; changed: boolean }>(response)
      onSaved({ version: data.version, title: sentTitle.trim(), body: sentBody.trim(), changed: data.changed })
      setOpen(false)
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Panel içeriğini düzenle
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <p className="text-sm" style={{ color: 'var(--color-warning)' }}>
        E-posta yeniden gönderilmez; satıcı panelinde "Güncellendi" olarak görünür. Medya gönderimden sonra
        değiştirilemez.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="sent-title">Başlık</Label>
        <Input
          id="sent-title"
          disabled={saving}
          value={draftTitle}
          maxLength={ANNOUNCEMENT_TITLE_MAX}
          onChange={(event) => setDraftTitle(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sent-body">Metin</Label>
        <Textarea
          id="sent-body"
          rows={8}
          disabled={saving}
          value={draftBody}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          onChange={(event) => setDraftBody(event.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" loading={saving} onClick={() => void handleSave()}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </div>
  )
}
