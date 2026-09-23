'use client'

import { useState } from 'react'
import { AnnouncementContent, Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@hanuja/ui'
import { readApiData, readApiError } from '../../_components/api'
import type { DisplayMedia, EmailPreviewResult } from '../../_components/types'

interface ContentPreviewProps {
  announcementId: string
  title: string
  body: string
  displayMedia: DisplayMedia | null
  ensureSaved: () => Promise<number | null>
}

export function ContentPreview({ announcementId, title, body, displayMedia, ensureSaved }: ContentPreviewProps) {
  const [email, setEmail] = useState<EmailPreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadEmailPreview() {
    setLoading(true)
    setError(null)
    try {
      const savedVersion = await ensureSaved()
      if (savedVersion === null) {
        setError('Önizleme öncesi taslak kaydedilemedi.')
        return
      }
      const response = await fetch(`/api/admin/announcements/${announcementId}/email-preview`)
      if (!response.ok) {
        setError(await readApiError(response, 'E-posta önizlemesi alınamadı.'))
        return
      }
      setEmail(await readApiData<EmailPreviewResult>(response))
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
        İçerik önizlemesi
      </p>
      <Tabs defaultValue="panel">
        <TabsList>
          <TabsTrigger value="panel">Satıcı panelinde</TabsTrigger>
          <TabsTrigger value="email">E-posta</TabsTrigger>
        </TabsList>
        <TabsContent value="panel">
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <AnnouncementContent
              title={title.trim() || 'Başlıksız duyuru'}
              body={body}
              media={displayMedia}
            />
          </div>
        </TabsContent>
        <TabsContent value="email">
          <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadEmailPreview()}>
              {loading ? 'Yükleniyor…' : email ? 'Önizlemeyi yenile' : 'E-posta önizlemesini yükle'}
            </Button>
            {error && (
              <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {error}
              </p>
            )}
            {email && (
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                    Konu:{' '}
                  </span>
                  {email.subject}
                </p>
                <iframe
                  sandbox=""
                  srcDoc={email.html}
                  title="E-posta önizlemesi"
                  className="h-[640px] w-full rounded border"
                  style={{ borderColor: 'var(--color-border)' }}
                />
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
