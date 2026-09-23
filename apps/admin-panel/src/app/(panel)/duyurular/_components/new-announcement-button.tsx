'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { readApiError, readApiData } from './api'

export function NewAnnouncementButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const response = await csrfFetch('/api/admin/announcements', { method: 'POST' })
      if (!response.ok) {
        setError(await readApiError(response, 'Taslak oluşturulamadı.'))
        return
      }
      const data = await readApiData<{ id: string }>(response)
      router.push(`/duyurular/${data.id}`)
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={loading}>
        {loading ? 'Oluşturuluyor…' : 'Yeni duyuru'}
      </Button>
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
