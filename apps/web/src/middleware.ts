/**
 * Next.js Middleware — customer storefront route protection + CSRF token issuance.
 *
 * Protected paths (require login):
 *   /hesabim/*   — customer account area
 *   /faturalarim  — customer invoice list
 *   /siparis      — customer order list
 *   /siparis/*   — order detail/tracking
 *   /sepet/odeme  — checkout (cart itself is public)
 *
 * CSRF:
 *   Issues a CSRF token cookie on every HTML page response (non-API, non-asset).
 *   Token is verified in mutating API route handlers via checkCsrf().
 *
 * Role enforcement:
 *   All authenticated customers are allowed. Sellers/admins who happen
 *   to browse the storefront are also allowed (they have valid sessions).
 */
import { betterFetch } from '@better-fetch/fetch'
import { NextResponse, type NextRequest } from 'next/server'
import {
  generateCsrfToken,
  getCsrfCookieOptions,
  getMirrorCsrfCookieOptions,
  CSRF_COOKIE_NAME,
  CSRF_MIRROR_COOKIE_NAME,
} from '@hanuja/security/csrf'

interface Session {
  user: {
    id: string
    email: string
    role: string
  }
}

const PROTECTED_PATTERNS = [
  /^\/hesabim/,
  /^\/faturalarim$/,
  /^\/siparis(?:\/|$)/,
  /^\/sepet\/odeme/,
]

function isProtected(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(pathname))
}

function isApiOrAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // For API and static asset routes, skip all middleware logic
  if (isApiOrAsset(pathname)) {
    return NextResponse.next()
  }

  // Issue CSRF token cookie if not already set
  const existingCsrf = request.cookies.get(CSRF_COOKIE_NAME)?.value
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-hanuja-pathname', pathname)
  const nextResponse = () => NextResponse.next({ request: { headers: requestHeaders } })
  let response: NextResponse

  if (!isProtected(pathname)) {
    response = nextResponse()
  } else {
    const { data: session } = await betterFetch<Session>(
      '/api/auth/get-session',
      {
        baseURL: request.nextUrl.origin,
        headers: { cookie: request.headers.get('cookie') ?? '' },
      },
    )

    if (!session?.user) {
      const loginUrl = new URL('/giris', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    response = nextResponse()
  }

  // Set CSRF cookies if missing.
  // Two cookies with the same token value:
  //   hanuja-csrf        — HttpOnly, unreadable by JS (server comparison target)
  //   hanuja-csrf-mirror — NOT HttpOnly, JS reads this to set x-csrf-token header
  if (!existingCsrf) {
    const token = generateCsrfToken()
    const isProduction = process.env['NODE_ENV'] === 'production'
    response.cookies.set(CSRF_COOKIE_NAME, token, getCsrfCookieOptions(isProduction))
    response.cookies.set(CSRF_MIRROR_COOKIE_NAME, token, getMirrorCsrfCookieOptions(isProduction))
  }

  // Security headers safe for storefront (no X-Frame-Options: DENY — Iyzico 3DS uses iframes)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (process.env.PREVIEW_DEPLOYMENT === 'true') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
