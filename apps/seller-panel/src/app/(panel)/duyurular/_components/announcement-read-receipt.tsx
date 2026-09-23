'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { startReadReceipt } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface AnnouncementReadReceiptProps {
  announcementId: string
  unread: boolean
}

/**
 * Marks the announcement read once it is actually shown: a server render or a link
 * prefetch never clears the unread badge. Transient failures are retried a few times.
 */
export function AnnouncementReadReceipt({ announcementId, unread }: AnnouncementReadReceiptProps) {
  const router = useRouter()

  useEffect(() => {
    if (!unread) return
    let receipt: ReturnType<typeof startReadReceipt> | null = null
    const frame = requestAnimationFrame(() => {
      receipt = startReadReceipt({
        send: () =>
          csrfFetch(`/api/seller/announcements/${announcementId}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }),
        onAdvanced: () => router.refresh(),
        isVisible: () => document.visibilityState === 'visible',
        onVisibilityChange: (listener) => {
          document.addEventListener('visibilitychange', listener)
          return () => document.removeEventListener('visibilitychange', listener)
        },
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      receipt?.cancel()
    }
  }, [announcementId, unread, router])

  return null
}
