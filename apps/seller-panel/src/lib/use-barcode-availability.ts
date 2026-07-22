'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type BarcodeAvailabilityStatus = 'idle' | 'checking' | 'available' | 'invalid' | 'duplicate_in_request' | 'in_use' | 'error'

export interface BarcodeCheckItem {
  key: string
  barcode: string
}

export interface BarcodeAvailabilityResult {
  barcode: string
  normalized: string | null
  status: BarcodeAvailabilityStatus
  message: string | null
}

const IDLE_RESULT: BarcodeAvailabilityResult = {
  barcode: '',
  normalized: null,
  status: 'idle',
  message: null,
}

/** Debounces one batch request for product and variant barcode fields. */
export function useBarcodeAvailability(items: BarcodeCheckItem[], excludeProductId?: string) {
  const [results, setResults] = useState<Record<string, BarcodeAvailabilityResult>>({})
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const requestItems = useMemo(
    () => items.filter((item) => item.barcode.trim().length === 13),
    [items],
  )
  const itemSignature = useMemo(
    () => requestItems.map((item) => `${item.key}:${item.barcode.trim()}`).sort().join('|'),
    [requestItems],
  )

  useEffect(() => {
    abortRef.current?.abort()

    const currentKeys = new Set(items.map((item) => item.key))
    if (requestItems.length === 0) {
      setResults((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => currentKeys.has(key)),
      ))
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestIdRef.current
    setResults((current) => ({
      ...current,
      ...Object.fromEntries(requestItems.map((item) => [item.key, {
        barcode: item.barcode.trim(),
        normalized: null,
        status: 'checking' as const,
        message: 'Barkod kontrol ediliyor...',
      }])),
    }))

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/seller/products/barcodes/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ items: requestItems, ...(excludeProductId ? { excludeProductId } : {}) }),
        })
        const payload = await response.json().catch(() => ({})) as {
          results?: Array<{ key: string; barcode: string; normalized?: string | null; status: BarcodeAvailabilityStatus; message?: string }>
        }
        if (!response.ok) throw new Error('Barkod kontrolu tamamlanamadi.')
        if (requestId !== requestIdRef.current) return

        setResults((current) => ({
          ...current,
          ...Object.fromEntries((payload.results ?? []).map((result) => [result.key, {
            barcode: result.barcode,
            normalized: result.normalized ?? null,
            status: result.status,
            message: result.message ?? null,
          }])),
        }))
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return
        setResults((current) => ({
          ...current,
          ...Object.fromEntries(requestItems.map((item) => [item.key, {
            barcode: item.barcode.trim(),
            normalized: null,
            status: 'error' as const,
            message: error instanceof Error ? error.message : 'Barkod kontrolu tamamlanamadi.',
          }])),
        }))
      }
    }, 400)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [excludeProductId, itemSignature, items, requestItems])

  return {
    results,
    getResult: (key: string) => results[key] ?? IDLE_RESULT,
  }
}
