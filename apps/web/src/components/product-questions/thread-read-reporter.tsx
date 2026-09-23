'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { startReadReceipt } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

/**
 * Reports the last message actually rendered on screen as read. Runs only in a
 * mounted, visible page — a `<Link>` prefetch or a server render never marks a
 * conversation read. The server checks the message belongs to this thread and
 * only moves the read boundary forward. Transient failures are retried a few
 * times (see `startReadReceipt`); a successful report is not repeated.
 */
export function ThreadReadReporter({
  readUrl,
  lastMessageId,
}: {
  readUrl: string
  lastMessageId: string | null
}) {
  const router = useRouter()

  useEffect(() => {
    if (!lastMessageId) return
    let receipt: ReturnType<typeof startReadReceipt> | null = null
    // After the thread is painted (next frame), never during render.
    const frame = requestAnimationFrame(() => {
      receipt = startReadReceipt({
        send: () =>
          csrfFetch(readUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastSeenMessageId: lastMessageId }),
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
  }, [readUrl, lastMessageId, router])

  return null
}
