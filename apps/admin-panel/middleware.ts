/**
 * Next.js Middleware — admin panel route protection.
 *
 * All routes require authentication AND admin role, except:
 *   /giris   — login page
 *   /api/*   — API routes (auth handles internally)
 *
 * Role enforcement:
 *   - Unauthenticated → /giris
 *   - Authenticated non-admin (customer or seller) → /giris with error param
 *   - Admin → allow all routes
 *
 * Security: This is a critical surface — only admin role may access any page.
 */
import { betterFetch } from '@better-fetch/fetch'
import { NextResponse, type NextRequest } from 'next/server'
import {
  generateCsrfToken,
  getCsrfCookieOptions,
  getMirrorCsrfCookieOptions,
  CSRF_COOKIE_NAME,
  CSRF_MIRROR_COOKIE_NAME,
} from '@hanuja/security'
import { isPublicAdminPath } from './src/lib/admin-public-paths'

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
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (isPublicAdminPath(pathname) || pathname === '/api' || pathname.startsWith('/api/')) {
    const res = NextResponse.next()
    applySecurityHeaders(res)
    return res
  }

  const { data: session } = await betterFetch<Session>('/api/auth/get-session', {
    baseURL: request.nextUrl.origin,
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })

  if (!session?.user) {
    const res = NextResponse.redirect(new URL('/giris', request.url))
    applySecurityHeaders(res)
    return res
  }

  if (session.user.role !== 'admin') {
    // Non-admin tried to access the admin panel
    const loginUrl = new URL('/giris', request.url)
    loginUrl.searchParams.set('error', 'unauthorized')
    const res = NextResponse.redirect(loginUrl)
    applySecurityHeaders(res)
    return res
  }

  const response = NextResponse.next()
  applySecurityHeaders(response)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
