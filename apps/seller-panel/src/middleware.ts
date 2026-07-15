import { NextResponse, type NextRequest } from 'next/server'

const CSRF_COOKIE_NAME = 'hanuja-csrf'
const CSRF_MIRROR_COOKIE_NAME = 'hanuja-csrf-mirror'

function generateEdgeCsrfToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
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
  return response
}

export const config = {
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
