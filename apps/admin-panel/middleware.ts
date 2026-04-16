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
  if (pathname.startsWith('/giris') || pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  const { data: session } = await betterFetch<Session>(
    '/api/auth/get-session',
    {
      baseURL: request.nextUrl.origin,
      headers: { cookie: request.headers.get('cookie') ?? '' },
    },
  )

  if (!session?.user) {
    return NextResponse.redirect(new URL('/giris', request.url))
  }

  if (session.user.role !== 'admin') {
    // Non-admin tried to access the admin panel
    const loginUrl = new URL('/giris', request.url)
    loginUrl.searchParams.set('error', 'unauthorized')
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|giris|api).*)',
  ],
}
