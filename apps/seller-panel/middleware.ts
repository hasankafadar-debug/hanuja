/**
 * Next.js Middleware — seller panel route protection.
 *
 * All routes require authentication AND seller role, except:
 *   /giris         — login page
 *   /onboarding/*  — new seller onboarding (requires auth, not yet a seller)
 *   /api/*         — API routes (auth handles internally)
 *
 * Role enforcement:
 *   - Unauthenticated → /giris
 *   - Authenticated customer (no seller role) on non-onboarding page → /onboarding
 *   - Authenticated seller → allow
 *   - Admin trying to access seller panel → allow (for support purposes)
 */
import { betterFetch } from '@better-fetch/fetch'
import { NextResponse, type NextRequest } from 'next/server'

interface Session {
  user: {
    id: string
    email: string
    role: string
  }
}

const PUBLIC_PATHS = ['/giris', '/api']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next()
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
    return NextResponse.redirect(loginUrl)
  }

  const role = session.user.role

  // Customer trying to access panel pages (not onboarding) → push to onboarding
  if (role === 'customer' && !pathname.startsWith('/onboarding')) {
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  // Seller or admin → allow all panel routes
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|giris|api).*)',
  ],
}
