import { betterFetch } from '@better-fetch/fetch'
import { NextResponse, type NextRequest } from 'next/server'
import { isPublicAdminPath } from './lib/admin-public-paths'

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
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicAdminPath(pathname) || pathname === '/api' || pathname.startsWith('/api/')) {
    return applySecurityHeaders(request, NextResponse.next())
  }

  const { data: session } = await betterFetch<Session>('/api/auth/get-session', {
    baseURL: request.nextUrl.origin,
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })

  if (!session?.user) {
    return applySecurityHeaders(request, NextResponse.redirect(new URL('/giris', request.url)))
  }

  if (session.user.role !== 'admin') {
    const loginUrl = new URL('/giris', request.url)
    loginUrl.searchParams.set('error', 'unauthorized')
    return applySecurityHeaders(request, NextResponse.redirect(loginUrl))
  }

  return applySecurityHeaders(request, NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
