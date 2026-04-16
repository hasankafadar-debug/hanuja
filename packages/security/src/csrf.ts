/**
 * CSRF protection via double-submit cookie pattern.
 *
 * Flow:
 * 1. On page load, server issues a CSRF token in a Secure HttpOnly cookie.
 * 2. Client reads the token from a non-HttpOnly JS-readable cookie and sends it
 *    as a request header (X-CSRF-Token).
 * 3. Server compares the header token with the cookie token using timing-safe equality.
 *
 * For Next.js App Router, same-site cookie + origin header check is usually
 * sufficient. This module adds an explicit token layer for extra protection on
 * state-mutating API routes.
 */
import { randomBytes, timingSafeEqual } from 'crypto'

export const CSRF_COOKIE_NAME = 'hanuja-csrf'
export const CSRF_HEADER_NAME = 'x-csrf-token'
export const CSRF_TOKEN_BYTES = 32

// ── Token generation ──────────────────────────────────────────────────────────

export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('hex')
}

// ── Token verification ────────────────────────────────────────────────────────

/**
 * Verifies that the token from the request header matches the token stored
 * in the cookie, using timing-safe comparison.
 */
export function verifyCsrfToken(
  cookieToken: string | undefined,
  headerToken: string | undefined,
): boolean {
  if (!cookieToken || !headerToken) return false
  if (cookieToken.length !== headerToken.length) return false

  try {
    const a = Buffer.from(cookieToken, 'utf8')
    const b = Buffer.from(headerToken, 'utf8')
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── Origin check (complement to CSRF token) ───────────────────────────────────

/**
 * Validates that the request origin matches the expected application origin.
 * Should be used in combination with token verification for state-mutating routes.
 */
export function isOriginAllowed(
  originHeader: string | null,
  allowedOrigins: string[],
): boolean {
  if (!originHeader) return false
  return allowedOrigins.some(
    (allowed) => originHeader === allowed || originHeader.startsWith(`${allowed}/`),
  )
}

// ── Cookie options ────────────────────────────────────────────────────────────

export interface CsrfCookieOptions {
  httpOnly: boolean
  secure: boolean
  sameSite: 'strict' | 'lax' | 'none'
  path: string
  maxAge: number
}

export function getCsrfCookieOptions(isProduction: boolean): CsrfCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  }
}
