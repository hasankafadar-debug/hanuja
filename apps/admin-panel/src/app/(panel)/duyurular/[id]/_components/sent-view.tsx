'use client'

import { useState } from 'react'
import { AnnouncementContent, Button, PageHeader } from '@hanuja/ui'
import type { AnnouncementProgressCounts } from '@hanuja/api/domain/announcement-progress'
import { formatIstanbulDateTime } from '../../_components/api'
import type { AnnouncementSentInitial } from '../../_components/types'
import { SentContentEdit } from './sent-content-edit'
import { ProgressPanel } from './progress-panel'
import { RetryDialog } from './retry-dialog'

interface SentViewProps {
  initial: AnnouncementSentInitial
}

export function SentView({ initial }: SentViewProps) {
  const [version, setVersion] = useState(initial.version)
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [editedAfterSendAt, setEditedAfterSendAt] = useState(initial.editedAfterSendAt)
  const [showSentText, setShowSentText] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [retryOpen, setRetryOpen] = useState(false)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [counts, setCounts] = useState<AnnouncementProgressCounts | null>(null)

  const emailTextDiffers = initial.sentTitle !== title || initial.sentBody !== body

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gönderilmiş duyuru"
        description={`Gönderim tarihi: ${formatIstanbulDateTime(initial.sentAt)} · Alıcı sayısı: ${initial.recipientCount}`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <AnnouncementContent
              title={title}
              body={body}
              sentAt={initial.sentAt}
              editedAt={editedAfterSendAt}
              media={initial.displayMedia}
            />
          </div>

          {emailTextDiffers && (
            <div>
              <button
                type="button"
                onClick={() => setShowSentText((current) => !current)}
                className="text-sm underline-offset-2 hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                {showSentText ? 'E-postada giden metni gizle' : 'E-postada giden metni göster'}
              </button>
              {showSentText && (
                <div
                  className="mt-2 space-y-2 rounded-lg border p-3 text-sm"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
                >
                  <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                    {initial.sentTitle}
                  </p>
                  <p className="whitespace-pre-wrap">{initial.sentBody}</p>
                </div>
              )}
            </div>
          )}

          <SentContentEdit
            announcementId={initial.id}
            version={version}
            title={title}
            body={body}
            onSaved={(next) => {
              setVersion(next.version)
              if (!next.changed) return
              setTitle(next.title)
              setBody(next.body)
              setEditedAfterSendAt(new Date().toISOString())
            }}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <ProgressPanel announcementId={initial.id} refreshToken={refreshToken} onCountsChange={setCounts} />
          </div>

          <div className="flex flex-col items-start gap-2">
            <Button type="button" variant="outline" disabled={!counts || counts.failed === 0} onClick={() => setRetryOpen(true)}>
              Başarısızları yeniden dene
            </Button>
            {retryMessage && (
              <p className="text-sm" style={{ color: 'var(--color-success)' }}>
                {retryMessage}
              </p>
            )}
          </div>
        </div>
      </div>

      <RetryDialog
        open={retryOpen}
        onOpenChange={setRetryOpen}
        announcementId={initial.id}
        onRetryQueued={(requestedCount) => {
          setRetryMessage(
            `${requestedCount} alıcı yeniden deneme kuyruğuna alındı; kapasite açıldıkça gönderilir.`,
          )
          setRefreshToken((current) => current + 1)
        }}
      />
    </div>
  )
}
