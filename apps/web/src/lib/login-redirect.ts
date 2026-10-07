import type { NextRequest } from 'next/server'
import { getWebBaseUrl } from '@hanuja/api/lib/platform-info'

const DEFAULT_RETURN_PATH = '/hesabim'
const INTERNAL_BASE = 'https://internal.invalid'
const BACKSLASH_OR_CONTROL = /[\\\u0000-\u001f\u007f]/
const DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/

function passesShapeRules(candidate: string): boolean {
  if (BACKSLASH_OR_CONTROL.test(candidate)) return false
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return false
  const pathPart = candidate.split(/[?#]/, 1)[0] ?? ''
  return !DOT_SEGMENT.test(pathPart)
}

// Encoded separators and dot segments (`%2F%2F`, `%5C`, `%2e%2e`) are rejected
// too: a legitimate app path never contains them, and a URL normaliser could
// otherwise turn them into a protocol-relative `//host` after the checks ran.
function isSafeShape(value: string): boolean {
  if (!passesShapeRules(value)) return false
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  return passesShapeRules(decoded)
}

function normalizeInternal(value: string): string | null {
  let url: URL
  try {
    url = new URL(value, INTERNAL_BASE)
  } catch {
    return null
  }
  if (url.origin !== INTERNAL_BASE) return null
  return url.pathname + url.search + url.hash
}

/**
 * Returns `value` only when it is an in-app path, otherwise `fallback`.
 * The normalised result is validated a second time, so an input such as
 * `/a/..//evil.com` can never come back out as `//evil.com`.
 */
export function safeInternalPath(value: unknown, fallback: string = DEFAULT_RETURN_PATH): string {
  if (typeof value !== 'string' || value.length === 0) return fallback
  if (!isSafeShape(value)) return fallback

  const candidate = normalizeInternal(value)
  if (candidate === null || !isSafeShape(candidate)) return fallback
  if (normalizeInternal(candidate) !== candidate) return fallback
  return candidate
}

/**
 * Login URL that returns the visitor to `returnTo` after sign-in. Only an
 * app-relative path is accepted so an e-mail link can never bounce the reader
 * to another host.
 */
export function loginRedirectUrl(req: NextRequest, returnTo: string): URL {
  // A reverse proxy can expose an internal origin (0.0.0.0:3000) to Next.js.
  // Production return links must use the configured customer site, never Host
  // or forwarded headers. Keep unconfigured local development on its own origin.
  const base = process.env.NEXT_PUBLIC_WEB_URL?.trim() || process.env.NODE_ENV === 'production'
    ? getWebBaseUrl()
    : req.nextUrl.origin
  const url = new URL('/giris', base)
  url.searchParams.set('callbackUrl', safeInternalPath(returnTo))
  return url
}
