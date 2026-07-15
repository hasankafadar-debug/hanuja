import { NextResponse, type NextRequest } from 'next/server'

export function middleware(_request: NextRequest) {
  const response = NextResponse.next()

  if (process.env.PREVIEW_DEPLOYMENT === 'true') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
