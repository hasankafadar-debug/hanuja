import { betterFetch } from '@better-fetch/fetch'
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

    const { data: session } = await betterFetch<Session>('/api/auth/get-session', {
      baseURL: request.nextUrl.origin,
      headers: { cookie: request.headers.get('cookie') ?? '' },
    })

    if (session?.user.role === 'seller' && session.user.mustChangePassword) {
      return passwordChangeRequiredApiResponse()
    }

    // API route handlers retain responsibility for authentication and roles.
    return NextResponse.next()
  }

  if (isPublicPath(pathname)) {
    return applySecurityHeaders(request, NextResponse.next())
  }

  const { data: session } = await betterFetch<Session>('/api/auth/get-session', {
    baseURL: request.nextUrl.origin,
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })

  if (!session?.user) {
    const loginUrl = new URL('/giris', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return applySecurityHeaders(request, NextResponse.redirect(loginUrl))
  }

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
