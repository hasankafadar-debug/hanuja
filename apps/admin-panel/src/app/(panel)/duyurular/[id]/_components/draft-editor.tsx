'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AnnouncementAudience } from '@hanuja/api/domain/announcement-audience'
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '@hanuja/api/domain/announcement-audience'
import { Button, ConfirmDialog, Input, Label, PageHeader, Textarea } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { readApiData, readApiError } from '../../_components/api'
import type { AnnouncementDraftInitial, FilterOptionsData, ManualSellerRef } from '../../_components/types'
import { MediaSection, type MediaState } from './media-section'
import { AudienceBuilder } from './audience-builder'
import { RecipientPreview, type PreviewSummary } from './recipient-preview'
import { ContentPreview } from './content-preview'
import { SendDialog } from './send-dialog'

interface DraftEditorProps {
  initial: AnnouncementDraftInitial
  filterOptions: FilterOptionsData
}

function mediaStateFromInitial(initial: AnnouncementDraftInitial): MediaState {
  if (!initial.media) return { mediaAssetId: null, mediaKind: null, mediaUrl: null, posterAssetId: null, posterUrl: null }
  const display = initial.displayMedia
  if (initial.media.kind === 'video') {
    return {
      mediaAssetId: initial.media.id,
      mediaKind: 'video',
      mediaUrl: display?.kind === 'video' ? display.url : null,
      posterAssetId: initial.poster?.id ?? null,
      posterUrl: display?.kind === 'video' ? display.posterUrl : null,
    }
  }
  return {
    mediaAssetId: initial.media.id,
    mediaKind: 'image',
    mediaUrl: display?.kind === 'image' ? display.url : null,
    posterAssetId: null,
    posterUrl: null,
  }
}

export function DraftEditor({ initial, filterOptions }: DraftEditorProps) {
  const router = useRouter()

  const [version, setVersion] = useState(initial.version)
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [media, setMedia] = useState<MediaState>(() => mediaStateFromInitial(initial))
  const [audience, setAudience] = useState<AnnouncementAudience>(initial.audience)
  const [manualSellers, setManualSellers] = useState<Record<string, ManualSellerRef>>(() =>
    Object.fromEntries(initial.manualSellers.map((seller) => [seller.id, seller])),
  )
  const [dirty, setDirty] = useState(false)
  // Save bookkeeping read by async flows (preview, exclusion) that may run with an
  // older render's closure: the saved version and whether edits are unsaved.
  const syncRef = useRef({ version: initial.version, dirty: false })

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [preview, setPreview] = useState<PreviewSummary | null>(null)

  const [sendOpen, setSendOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  function markDirty() {
    syncRef.current.dirty = true
    setDirty(true)
    setSaveMessage(null)
  }

  async function doSave(overrides: { audience?: AnnouncementAudience } = {}): Promise<number | null> {
    setSaving(true)
    setSaveError(null)
    try {
      const response = await csrfFetch(`/api/admin/announcements/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: syncRef.current.version,
          title,
          body,
          mediaAssetId: media.mediaAssetId,
          posterAssetId: media.posterAssetId,
          audience: overrides.audience ?? audience,
        }),
      })
      if (!response.ok) {
        setSaveError(await readApiError(response, 'Taslak kaydedilemedi.'))
        return null
      }
      const data = await readApiData<{ version: number }>(response)
      syncRef.current = { version: data.version, dirty: false }
      setVersion(data.version)
      setDirty(false)
      setSaveMessage('Taslak kaydedildi.')
      return data.version
    } catch {
      setSaveError('Bağlantı hatası oluştu.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function ensureSaved(): Promise<number | null> {
    if (!syncRef.current.dirty) return syncRef.current.version
    return doSave()
  }

  /** Applies an exclusion change and saves it in the same step, so the next preview sees it. */
  async function saveExclusions(update: (ids: string[]) => string[]): Promise<number | null> {
    const next = { ...audience, excludedSellerIds: update(audience.excludedSellerIds) }
    setAudience(next)
    markDirty()
    return doSave({ audience: next })
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const response = await csrfFetch(`/api/admin/announcements/${initial.id}`, { method: 'DELETE' })
      if (!response.ok) {
        setDeleteError(await readApiError(response, 'Taslak silinemedi.'))
        return
      }
      router.push('/duyurular')
    } catch {
      setDeleteError('Bağlantı hatası oluştu.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleSend() {
    if (!preview) return
    setSending(true)
    setSendError(null)
    try {
      const response = await csrfFetch(`/api/admin/announcements/${initial.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: preview.version, audienceHash: preview.audienceHash }),
      })
      if (!response.ok) {
        setSendError(await readApiError(response, 'Duyuru gönderilemedi.'))
        return
      }
      setSendOpen(false)
      router.refresh()
    } catch {
      setSendError('Bağlantı hatası oluştu.')
    } finally {
      setSending(false)
    }
  }

  const canSend = preview !== null && !dirty && preview.version === version && preview.count > 0

  const displayMediaForPreview = useMemo(() => {
    if (!media.mediaKind) return null
    if (media.mediaKind === 'image') return media.mediaUrl ? ({ kind: 'image', url: media.mediaUrl } as const) : null
    return { kind: 'video', url: media.mediaUrl, posterUrl: media.posterUrl } as const
  }, [media])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Duyuru taslağı"
        description="Satıcı panelinde ve e-posta ile gönderilecek duyuruyu hazırlayın."
        actions={
          <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
            Taslağı sil
          </Button>
        }
      />

      {initial.audienceInvalid && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          Kayıtlı alıcı seçimi geçersizdi ve varsayılana sıfırlandı. Alıcıları yeniden seçip kaydedin.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="space-y-4 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="space-y-1.5">
              <Label htmlFor="announcement-title">Başlık</Label>
              <Input
                id="announcement-title"
                value={title}
                maxLength={ANNOUNCEMENT_TITLE_MAX}
                onChange={(event) => {
                  setTitle(event.target.value)
                  markDirty()
                }}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {title.length} / {ANNOUNCEMENT_TITLE_MAX}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="announcement-body">Metin</Label>
              <Textarea
                id="announcement-body"
                rows={10}
                value={body}
                maxLength={ANNOUNCEMENT_BODY_MAX}
                onChange={(event) => {
                  setBody(event.target.value)
                  markDirty()
                }}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {body.length} / {ANNOUNCEMENT_BODY_MAX}
              </p>
            </div>

            <MediaSection
              value={media}
              onChange={(next) => {
                setMedia(next)
                markDirty()
              }}
              disabled={saving}
            />
          </div>

          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <AudienceBuilder
              audience={audience}
              manualSellers={manualSellers}
              filterOptions={filterOptions}
              onAudienceChange={(updater) => {
                setAudience((prev) => updater(prev))
                markDirty()
              }}
              onManualSellersChange={setManualSellers}
              disabled={saving}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void doSave()} disabled={saving || !dirty}>
              {saving ? 'Kaydediliyor…' : 'Taslağı kaydet'}
            </Button>
            {saveMessage && (
              <p className="text-sm" style={{ color: 'var(--color-success)' }}>
                {saveMessage}
              </p>
            )}
            {saveError && (
              <div className="flex items-center gap-3">
                <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                  {saveError}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Sayfayı yenile
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <RecipientPreview
              announcementId={initial.id}
              ensureSaved={ensureSaved}
              onPreviewChange={setPreview}
              onExclude={(sellerId) =>
                saveExclusions((ids) => (ids.includes(sellerId) ? ids : [...ids, sellerId]))
              }
              onUnexclude={(sellerId) => saveExclusions((ids) => ids.filter((id) => id !== sellerId))}
            />
          </div>

          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <ContentPreview
              announcementId={initial.id}
              title={title}
              body={body}
              displayMedia={displayMediaForPreview}
              ensureSaved={ensureSaved}
            />
          </div>

          <div className="flex flex-col items-end gap-2">
            <Button type="button" size="lg" disabled={!canSend} onClick={() => setSendOpen(true)}>
              Gönder
            </Button>
            {!canSend && (
              <p className="text-xs text-right" style={{ color: 'var(--color-muted-fg)' }}>
                Göndermek için önce taslağı kaydedip güncel bir alıcı önizlemesi alın.
              </p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Taslağı sil"
        description="Bu taslak kalıcı olarak silinecek. Bu işlem geri alınamaz."
        confirmLabel="Sil"
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />
      {deleteError && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {deleteError}
        </p>
      )}

      <SendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        recipientCount={preview?.count ?? 0}
        loading={sending}
        error={sendError}
        onConfirm={() => void handleSend()}
      />
    </div>
  )
}
