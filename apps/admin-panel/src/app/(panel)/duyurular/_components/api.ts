/**
 * Shared client-side helpers for the Duyuru (announcement) admin screens.
 * No Node-only imports — safe for 'use client' components.
 */

export interface ApiErrorPayload {
  success?: boolean
  code?: string
  message?: string
  error?: string
  errors?: unknown
}

/** Reads the JSON body of a failed response and returns a user-facing Turkish message. */
export async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null
  if (payload?.code === 'VALIDATION_ERROR') return 'Girilen bilgileri kontrol edin.'
  if (response.status === 409) return payload?.message ?? payload?.error ?? fallback
  return payload?.message ?? payload?.error ?? fallback
}

export async function readApiData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data: T }
  return payload.data
}

export function formatIstanbulDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
