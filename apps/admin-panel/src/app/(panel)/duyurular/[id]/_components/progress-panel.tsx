'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@hanuja/ui'
import {
  ANNOUNCEMENT_PROGRESS_BUCKETS,
  ANNOUNCEMENT_PROGRESS_LABELS,
  nextProgressPollDelayMs,
  type AnnouncementProgressBucket,
  type AnnouncementProgressCounts,
} from '@hanuja/api/domain/announcement-progress'
import { formatIstanbulDateTime, readApiData, readApiError } from '../../_components/api'
import type { ProgressResult } from '../../_components/types'

interface ProgressPanelProps {
  announcementId: string
  refreshToken: number
  onCountsChange?: (counts: AnnouncementProgressCounts) => void
}

export function ProgressPanel({ announcementId, refreshToken, onCountsChange }: ProgressPanelProps) {
  const [bucket, setBucket] = useState<AnnouncementProgressBucket | null>(null)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ProgressResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const timerRef = useRef<number | null>(null)

  const load = useCallback(
    async (targetBucket: AnnouncementProgressBucket | null, targetPage: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ sayfa: String(targetPage) })
        if (targetBucket) params.set('durum', targetBucket)
        const response = await fetch(`/api/admin/announcements/${announcementId}/progress?${params.toString()}`)
        if (!response.ok) {
          setError(await readApiError(response, 'İlerleme alınamadı.'))
          return
        }
        const result = await readApiData<ProgressResult>(response)
        setData(result)
        setLastUpdated(new Date())
        onCountsChange?.(result.counts)
      } catch {
        setError('Bağlantı hatası oluştu.')
      } finally {
        setLoading(false)
      }
    },
    [announcementId, onCountsChange],
  )

  useEffect(() => {
    void load(bucket, page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, page, refreshToken])

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (!data) return
    const delay = nextProgressPollDelayMs({
      counts: data.counts,
      awaitingResultCount: data.awaitingResultCount,
      lastSmtpAcceptedAt: data.lastSmtpAcceptedAt,
    })
    if (delay === null) return
    timerRef.current = window.setTimeout(() => {
      void load(bucket, page)
    }, delay)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Gönderim ilerlemesi
        </p>
        <div className="flex items-center gap-3">
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Son güncelleme: {lastUpdated ? lastUpdated.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'}
          </p>
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load(bucket, page)}>
            {loading ? 'Yükleniyor…' : 'Yenile'}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setBucket(null)
                setPage(1)
              }}
              className="rounded-full border px-3 py-1.5 text-xs font-medium"
              style={{
                borderColor: bucket === null ? 'var(--color-primary)' : 'var(--color-border)',
                backgroundColor: bucket === null ? 'var(--color-primary)' : 'transparent',
                color: bucket === null ? 'var(--color-primary-fg)' : 'var(--color-muted-fg)',
              }}
            >
              Tümü ({data.total})
            </button>
            {ANNOUNCEMENT_PROGRESS_BUCKETS.map((option) => {
              const count = data.counts[option]
              if (count === 0) return null
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setBucket(option)
                    setPage(1)
                  }}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium"
                  style={{
                    borderColor: bucket === option ? 'var(--color-primary)' : 'var(--color-border)',
                    backgroundColor: bucket === option ? 'var(--color-primary)' : 'transparent',
                    color: bucket === option ? 'var(--color-primary-fg)' : 'var(--color-muted-fg)',
                  }}
                >
                  {ANNOUNCEMENT_PROGRESS_LABELS[option]} ({count})
                </button>
              )
            })}
          </div>

          {data.awaitingResultCount > 0 && (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              SMTP kabul edilen e-postaların teslim sonucu sağlayıcıdan birkaç dakika içinde gelir.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs uppercase tracking-wide"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                >
                  <th className="px-3 py-2">Satıcı</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Hata kodu</th>
                  <th className="px-3 py-2">SMTP kabul</th>
                  <th className="px-3 py-2">Teslim</th>
                  <th className="px-3 py-2">Panelde okundu</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center" style={{ color: 'var(--color-muted-fg)' }}>
                      Bu filtrede kayıt yok.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-3 py-2">
                        {row.sellerName}
                        {row.sellerDeleted && (
                          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                            Hesap silindi
                            {row.dispatchCompleted && ' — silinmeden önce gönderim tamamlanmıştı'}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">{ANNOUNCEMENT_PROGRESS_LABELS[row.bucket]}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.lastError ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">{formatIstanbulDateTime(row.smtpAcceptedAt)}</td>
                      <td className="px-3 py-2 text-xs">{formatIstanbulDateTime(row.deliveredAt)}</td>
                      <td className="px-3 py-2 text-xs">{formatIstanbulDateTime(row.readAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex gap-4 text-sm">
            {page > 1 && (
              <button type="button" onClick={() => setPage((current) => current - 1)} style={{ color: 'var(--color-primary)' }}>
                Önceki
              </button>
            )}
            {page * data.pageSize < data.filteredTotal && (
              <button type="button" onClick={() => setPage((current) => current + 1)} style={{ color: 'var(--color-primary)' }}>
                Sonraki
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
