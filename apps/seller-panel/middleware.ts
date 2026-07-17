/**
 * Next.js Middleware — seller panel route protection.
 *
 * All routes require authentication AND seller role, except:
 *   /giris         — login page
 *   /onboarding/*  — legacy onboarding path, redirected to /basvuru
 *   /api/*         — API routes (auth handles internally)
 *
 * Role enforcement:
 *   - Unauthenticated → /giris
 *   - Authenticated customer (no seller role) on non-seller page → /basvuru
 *   - Authenticated seller → allow
 *   - Admin trying to access seller panel → allow (for support purposes)
 */
import { betterFetch } from '@better-fetch/fetch'
import { NextResponse, type NextRequest } from 'next/server'
import { generateCsrfToken, getCsrfCookieOptions, getMirrorCsrfCookieOptions, CSRF_COOKIE_NAME, CSRF_MIRROR_COOKIE_NAME } from '@hanuja/security'

function applySecurityHeaders(response: NextResponse): void {
  const csrfToken = generateCsrfToken()
  const isProduction = process.env['NODE_ENV'] === 'production'
  response.cookies.set(CSRF_COOKIE_NAME, csrfToken, getCsrfCookieOptions(isProduction))
  response.cookies.set(CSRF_MIRROR_COOKIE_NAME, csrfToken, getMirrorCsrfCookieOptions(isProduction))
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'")
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
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
  '/basvuru',
  '/basvuru/tesekkur',
  '/sifremi-unuttum',
  '/sifre-olustur',
  '/sifre-sifirla',
]

export function isPublicPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || PUBLIC_PATHS.includes(pathname)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/onboarding')) {
    const res = NextResponse.redirect(new URL('/basvuru', request.url))
    applySecurityHeaders(res)
    return res
  }

  if (isPublicPath(pathname)) {
    const res = NextResponse.next()
    applySecurityHeaders(res)
    return res
  }

  const { data: session } = await betterFetch<Session>(
    '/api/auth/get-session',
    {
      baseURL: request.nextUrl.origin,
      headers: { cookie: request.headers.get('cookie') ?? '' },
    },
  )

  // Not authenticated → redirect to login
  if (!session?.user) {
    const loginUrl = new URL('/giris', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    const res = NextResponse.redirect(loginUrl)
    applySecurityHeaders(res)
    return res
  }

  const role = session.user.role

  if (role === 'seller' && session.user.mustChangePassword && pathname !== '/sifre-olustur') {
    const res = NextResponse.redirect(new URL('/sifre-olustur', request.url))
    applySecurityHeaders(res)
    return res
  }

  // Customer trying to access seller panel pages → push to application flow
  if (role === 'customer' && pathname === '/') {
    const res = NextResponse.redirect(new URL('/giris', request.url))
    applySecurityHeaders(res)
    return res
  }

  if (role === 'customer' && !pathname.startsWith('/basvuru')) {
    const res = NextResponse.redirect(new URL('/basvuru', request.url))
    applySecurityHeaders(res)
    return res
  }

  // Seller or admin → allow all panel routes
  const response = NextResponse.next()
  applySecurityHeaders(response)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|giris|api).*)',
  ],
}
