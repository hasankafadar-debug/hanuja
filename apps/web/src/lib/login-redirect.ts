import type { NextRequest } from 'next/server'

/**
 * Login URL that returns the visitor to `returnTo` after sign-in. Only an
 * app-relative path is accepted so an e-mail link can never bounce the reader
 * to another host.
 */
export function loginRedirectUrl(req: NextRequest, returnTo: string): URL {
  const safePath = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/hesabim'
  const url = new URL('/giris', req.nextUrl.origin)
  url.searchParams.set('callbackUrl', safePath)
  return url
}
