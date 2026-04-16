/**
 * CORS middleware helpers for Hanuja Next.js apps.
 *
 * Usage in Next.js middleware.ts:
 *   import { withCors, DEFAULT_ALLOWED_ORIGINS } from '@hanuja/security'
 *   export function middleware(req) { return withCors(req, DEFAULT_ALLOWED_ORIGINS) }
 *
 * Usage in API route handlers:
 *   import { corsHeaders } from '@hanuja/security'
 *   return new Response(body, { headers: corsHeaders(origin, allowedOrigins) })
 */

import { NextRequest, NextResponse } from 'next/server'

/** Trusted cross-origin panels — pulled from env at runtime. */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  process.env['NEXT_PUBLIC_WEB_URL'] ?? 'http://localhost:3000',
  process.env['SELLER_PANEL_URL'] ?? 'http://localhost:3001',
  process.env['ADMIN_PANEL_URL'] ?? 'http://localhost:3002',
]

/** Returns true when the origin is in the allow-list. */
export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return false
  return allowedOrigins.some((allowed) => allowed === origin)
}

/** Builds a minimal set of CORS response headers for a given origin. */
export function corsHeaders(
  requestOrigin: string | null,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS,
): Record<string, string> {
  if (!requestOrigin || !isAllowedOrigin(requestOrigin, allowedOrigins)) {
    return {}
  }

  return {
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-CSRF-Token',
    'Vary': 'Origin',
  }
}

/**
 * Next.js middleware wrapper that adds CORS headers and handles preflight.
 *
 * Call this at the top of your middleware function and return the result
 * early when it is a preflight OPTIONS request:
 *
 *   export function middleware(req: NextRequest) {
 *     const corsResponse = withCors(req, DEFAULT_ALLOWED_ORIGINS)
 *     if (corsResponse) return corsResponse
 *     // ... rest of your middleware logic
 *   }
 */
export function withCors(
  req: NextRequest,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS,
): NextResponse | null {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin, allowedOrigins)

  // Preflight — respond immediately with 204
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers })
  }

  // For non-preflight, caller must add the headers themselves.
  // Return null to signal "no early exit needed".
  return null
}

/**
 * Adds CORS headers to an existing NextResponse in-place.
 * Use this when you need to pass through the response from downstream middleware.
 */
export function applyCorsHeaders(
  response: NextResponse,
  requestOrigin: string | null,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS,
): NextResponse {
  const headers = corsHeaders(requestOrigin, allowedOrigins)
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  return response
}
