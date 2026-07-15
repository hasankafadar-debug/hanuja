import { NextResponse, type NextRequest } from 'next/server'
import {
  CSRF_COOKIE_NAME,
  CSRF_MIRROR_COOKIE_NAME,
  generateCsrfToken,
  getCsrfCookieOptions,
  getMirrorCsrfCookieOptions,
} from '@hanuja/security'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  if (!request.cookies.get(CSRF_COOKIE_NAME)?.value) {
    const token = generateCsrfToken()
    const isProduction = process.env['NODE_ENV'] === 'production'
    response.cookies.set(CSRF_COOKIE_NAME, token, getCsrfCookieOptions(isProduction))
    response.cookies.set(
      CSRF_MIRROR_COOKIE_NAME,
      token,
      getMirrorCsrfCookieOptions(isProduction),
    )
  }

  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return response
}

export const config = {
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
