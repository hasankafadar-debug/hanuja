'use client'

import { useEffect } from 'react'
import { csrfFetch } from '@/lib/csrf-fetch'

export function ProductViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    const controller = new AbortController()

    void csrfFetch(`/api/products/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
      signal: controller.signal,
    }).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('[analytics] Failed to record product view', error)
    })

    return () => {
      controller.abort()
    }
  }, [slug])

  return null
}
