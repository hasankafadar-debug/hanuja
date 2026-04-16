/**
 * CSRF verification helper for Next.js API route handlers.
 *
 * Usage in a mutating route handler:
 *   const csrfError = checkCsrf(req)
 *   if (csrfError) return csrfError
 *
 * The token is read from:
 *   - Cookie: hanuja-csrf (set by middleware on page load)
 *   - Header: x-csrf-token (set by frontend JS before each mutating request)
 *
 * Skipped for: GET, HEAD, OPTIONS (safe methods).
 * Skipped for: API-key authenticated server-to-server requests (no cookie).
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@hanuja/security'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Returns a 403 NextResponse if CSRF verification fails, or null if it passes.
 *
 * In development mode, skips verification to avoid friction during local dev.
 * Set CSRF_STRICT=true in dev .env to enforce it locally.
 */
export function checkCsrf(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method)) return null

  // Skip in development unless explicitly enforced
  const isDev = process.env['NODE_ENV'] !== 'production'
  const csrfStrict = process.env['CSRF_STRICT'] === 'true'
  if (isDev && !csrfStrict) return null

  const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value
  const headerToken = req.headers.get(CSRF_HEADER_NAME) ?? undefined

  if (!verifyCsrfToken(cookieToken, headerToken)) {
    return NextResponse.json(
      { error: 'CSRF doğrulaması başarısız. Lütfen sayfayı yenileyip tekrar deneyin.' },
      { status: 403 },
    )
  }

  return null
}
