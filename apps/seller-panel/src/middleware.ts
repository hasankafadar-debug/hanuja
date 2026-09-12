import { betterFetch } from '@better-fetch/fetch'
import { getPanelInternalOrigin } from '@hanuja/security/panel-origin'
import { NextResponse, type NextRequest } from 'next/server'

const CSRF_COOKIE_NAME = 'hanuja-csrf'
const CSRF_MIRROR_COOKIE_NAME = 'hanuja-csrf-mirror'

function generateEdgeCsrfToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function applySecurityHeaders(request: NextRequest, response: NextResponse): NextResponse {
  if (!request.cookies.get(CSRF_COOKIE_NAME)?.value) {
    const token = generateEdgeCsrfToken()
    const isProduction = process.env['NODE_ENV'] === 'production'
    const commonOptions = {
      secure: isProduction,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 60 * 60 * 24,
    }
    response.cookies.set(CSRF_COOKIE_NAME, token, { ...commonOptions, httpOnly: true })
    response.cookies.set(CSRF_MIRROR_COOKIE_NAME, token, { ...commonOptions, httpOnly: false })
  }
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'")
  return response
}

interface Session {
  user: {
    id: string
    email: string
    role: string
    mustChangePassword?: boolean
  }
}

const PUBLIC_PATHS = [
  '/giris',
  '/iki-asamali-dogrulama',
  '/basvuru',
  '/basvuru/tesekkur',
  '/sifremi-unuttum',
  '/sifre-olustur',
  '/sifre-sifirla',
]

export function isPublicPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || PUBLIC_PATHS.includes(pathname)
}

const PASSWORD_RECOVERY_API_PATHS = new Set(['/api/seller/first-password'])

function isSellerOrMediaApiPath(pathname: string): boolean {
  return (
    pathname === '/api/seller' ||
    pathname.startsWith('/api/seller/') ||
    pathname === '/api/media' ||
    pathname.startsWith('/api/media/')
  )
}

type SessionCheck =
  | { kind: 'session'; session: Session }
  | { kind: 'anonymous' }
  | { kind: 'unavailable'; status?: number }

/**
 * Asks this panel's own Better Auth instance whether the request carries a
 * session. Three outcomes are deliberately kept apart: a real "no session"
 * answer (redirect to login), a session, and a check that could not be
 * completed (429 / 5xx / network). The last one must never be treated as
 * "logged out" — the (panel) layout and every API route handler re-validate
 * the session in-process, so the middleware passes the request through and
 * logs the failure instead of bouncing a valid seller to /giris.
 */
async function checkSession(request: NextRequest): Promise<SessionCheck> {
  const { pathname } = request.nextUrl
  try {
    const { data, error } = await betterFetch<Session | null>('/api/auth/get-session', {
      baseURL: getPanelInternalOrigin('seller'),
      headers: { cookie: request.headers.get('cookie') ?? '' },
    })

    if (error) {
      if (error.status === 401 || error.status === 403) {
        return { kind: 'anonymous' }
      }
      console.warn('[seller-middleware] session check unavailable', {
        status: error.status,
        pathname,
      })
      return { kind: 'unavailable', status: error.status }
    }

    return data?.user ? { kind: 'session', session: data } : { kind: 'anonymous' }
  } catch (error) {
    console.warn('[seller-middleware] session check failed', {
      pathname,
      error: error instanceof Error ? error.message : String(error),
    })
    return { kind: 'unavailable' }
  }
}

function passwordChangeRequiredApiResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Yeni şifrenizi oluşturmadan bu işlem yapılamaz.' },
    {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/onboarding')) {
    return applySecurityHeaders(request, NextResponse.redirect(new URL('/basvuru', request.url)))
  }

  const isSellerOrMediaApi = isSellerOrMediaApiPath(pathname)

  if (isSellerOrMediaApi) {
    if (PASSWORD_RECOVERY_API_PATHS.has(pathname)) {
      return NextResponse.next()
    }

    const check = await checkSession(request)

    if (
      check.kind === 'session' &&
      check.session.user.role === 'seller' &&
      check.session.user.mustChangePassword
    ) {
      return passwordChangeRequiredApiResponse()
    }

    // API route handlers retain responsibility for authentication and roles
    // (including mustChangePassword when the check above was unavailable).
    return NextResponse.next()
  }

  if (isPublicPath(pathname)) {
    return applySecurityHeaders(request, NextResponse.next())
  }

  const check = await checkSession(request)

  if (check.kind === 'unavailable') {
    // Let the page render; its layout re-validates the session in-process.
    return applySecurityHeaders(request, NextResponse.next())
  }

  if (check.kind === 'anonymous') {
    const loginUrl = new URL('/giris', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return applySecurityHeaders(request, NextResponse.redirect(loginUrl))
  }

  const { session } = check

  if (session.user.role === 'seller' && session.user.mustChangePassword) {
    return applySecurityHeaders(
      request,
      NextResponse.redirect(new URL('/sifre-olustur', request.url)),
    )
  }

  if (session.user.role === 'customer') {
    if (pathname === '/') {
      return applySecurityHeaders(request, NextResponse.redirect(new URL('/giris', request.url)))
    }
    return applySecurityHeaders(request, NextResponse.redirect(new URL('/basvuru', request.url)))
  }

  if (session.user.role !== 'seller' && session.user.role !== 'admin') {
    const loginUrl = new URL('/giris', request.url)
    loginUrl.searchParams.set('error', 'unauthorized')
    return applySecurityHeaders(request, NextResponse.redirect(loginUrl))
  }

  return applySecurityHeaders(request, NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/api/seller/:path*',
    '/api/media/:path*',
  ],
}
