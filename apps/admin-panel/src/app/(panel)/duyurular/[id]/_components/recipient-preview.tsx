'use client'

import { useState } from 'react'
import { Button } from '@hanuja/ui'
import { formatIstanbulDateTime, readApiData, readApiError } from '../../_components/api'
import type { RecipientPreviewResult } from '../../_components/types'

const STATUS_LABELS: Record<string, string> = { active: 'Aktif', suspended: 'Askıda' }

export interface PreviewSummary {
  version: number
  audienceHash: string
  count: number
}

interface RecipientPreviewProps {
  announcementId: string
  ensureSaved: () => Promise<number | null>
  onPreviewChange: (summary: PreviewSummary | null) => void
  /** Saves the draft with the exclusion applied; resolves to the saved version or null. */
  onExclude: (sellerId: string) => Promise<number | null>
  onUnexclude: (sellerId: string) => Promise<number | null>
}

export function RecipientPreview({
  announcementId,
  ensureSaved,
  onPreviewChange,
  onExclude,
  onUnexclude,
}: RecipientPreviewProps) {
  const [result, setResult] = useState<RecipientPreviewResult | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadPreview(targetPage: number) {
    setLoading(true)
    setError(null)
    try {
      const savedVersion = await ensureSaved()
      if (savedVersion === null) {
        setError('Önizleme öncesi taslak kaydedilemedi.')
        return
      }
      const response = await fetch(`/api/admin/announcements/${announcementId}/recipients?sayfa=${targetPage}`)
      if (!response.ok) {
        setError(await readApiError(response, 'Alıcı listesi alınamadı.'))
        onPreviewChange(null)
        return
      }
      const data = await readApiData<RecipientPreviewResult>(response)
      setResult(data)
      setPage(data.page)
      onPreviewChange({ version: data.version, audienceHash: data.audienceHash, count: data.count })
    } catch {
      setError('Bağlantı hatası oluştu.')
      onPreviewChange(null)
    } finally {
      setLoading(false)
    }
  }

  // The parent saves the exclusion first; the preview is then re-read for that saved version.
  async function exclude(sellerId: string) {
    setError(null)
    if ((await onExclude(sellerId)) === null) {
      setError('Satıcı listeden çıkarılamadı; taslak kaydedilemedi.')
      return
    }
    await loadPreview(1)
  }

  async function unexclude(sellerId: string) {
    setError(null)
    if ((await onUnexclude(sellerId)) === null) {
      setError('Satıcı listeye geri alınamadı; taslak kaydedilemedi.')
      return
    }
    await loadPreview(1)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Alıcı önizlemesi
        </p>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadPreview(1)}>
          {loading ? 'Yükleniyor…' : 'Alıcıları önizle'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
            Kesin alıcı sayısı: {result.count}
          </p>

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs uppercase tracking-wide"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                >
                  <th className="px-3 py-2">Mağaza</th>
                  <th className="px-3 py-2">Şirket</th>
                  <th className="px-3 py-2">Şehir / İlçe</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Doğrulama</th>
                  <th className="px-3 py-2">Kayıt tarihi</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center" style={{ color: 'var(--color-muted-fg)' }}>
                      Bu sayfada alıcı yok.
                    </td>
                  </tr>
                ) : (
                  result.rows.map((row) => (
                    <tr key={row.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-3 py-2">{row.displayName}</td>
                      <td className="px-3 py-2">{row.companyName ?? '—'}</td>
                      <td className="px-3 py-2">{[row.city, row.district].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="px-3 py-2">{STATUS_LABELS[row.status] ?? row.status}</td>
                      <td className="px-3 py-2">{row.isVerified ? 'Doğrulanmış' : 'Doğrulanmamış'}</td>
                      <td className="px-3 py-2">{formatIstanbulDateTime(row.createdAt)}</td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() => void exclude(row.id)}
                        >
                          Çıkar
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex gap-4 text-sm">
            {page > 1 && (
              <button type="button" onClick={() => void loadPreview(page - 1)} style={{ color: 'var(--color-primary)' }}>
                Önceki
              </button>
            )}
            {page * result.pageSize < result.count && (
              <button type="button" onClick={() => void loadPreview(page + 1)} style={{ color: 'var(--color-primary)' }}>
                Sonraki
              </button>
            )}
          </div>

          {result.excluded.count > 0 && (
            <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                Çıkarılan satıcılar ({result.excluded.count})
              </p>
              <div className="flex flex-wrap gap-2">
                {result.excluded.rows.map((row) => (
                  <span
                    key={row.id}
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
                  >
                    {row.displayName}
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void unexclude(row.id)}
                      style={{ color: 'var(--color-primary)' }}
                    >
                      Geri al
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!error && !result && (
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Göndermeden önce kesin alıcı listesini görmek için önizleyin.
        </p>
      )}
    </div>
  )
}
