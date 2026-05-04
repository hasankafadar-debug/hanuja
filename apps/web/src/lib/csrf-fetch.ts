'use client'

// Mirrors the HttpOnly CSRF cookie but is JS-readable so the client can forward
// it as a request header (double-submit cookie pattern).
const MIRROR_COOKIE = 'hanuja-csrf-mirror'
const CSRF_HEADER = 'x-csrf-token'

function readMirrorCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${MIRROR_COOKIE}=`))
  return match ? (match.split('=')[1] ?? null) : null
}

/**
 * Drop-in replacement for fetch() that automatically attaches the CSRF header
 * on every state-mutating request. Use for all storefront POST/PATCH/PUT/DELETE
 * calls that hit /api/* endpoints protected by checkCsrf().
 */
export async function csrfFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = readMirrorCookie()
  const headers = new Headers(init.headers)
  if (token) headers.set(CSRF_HEADER, token)
  return fetch(url, { ...init, headers })
}
