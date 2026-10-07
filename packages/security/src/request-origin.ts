/** Edge-compatible CSRF boundary for API routes, including native forms. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SIGNED_WEB_ROUTES = new Set([
  '/api/payment/callback',
  '/api/webhooks/iyzico',
  '/api/webhooks/resend',
  '/api/inbound/resend',
  '/api/inbound/postmark',
  '/api/inbound/postmark/store-discount',
  // RFC 8058 one-click unsubscribe is POSTed by the mail provider's servers
  // without browser metadata. The opt-out token in the query is the credential;
  // the handler uses no cookies.
  '/api/marketing/unsubscribe',
])

export function isApiMutationOriginAllowed(request: Request, canonicalUrl: string, surface: 'web' | 'panel'): boolean {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith('/api/') || SAFE_METHODS.has(request.method.toUpperCase())) return true
  // Provider endpoints have their own signature/credential verification and
  // cannot send browser Origin headers. Never exempt arbitrary webhook paths.
  if (surface === 'web' && SIGNED_WEB_ROUTES.has(pathname)) return true
  const origin = request.headers.get('origin')
  if (origin !== null) {
    try {
      const parsed = new URL(origin)
      return parsed.origin === origin && origin === new URL(canonicalUrl).origin
    } catch { return false }
  }
  // Browser-generated Fetch Metadata is forbidden to scripts. A sibling
  // subdomain reports same-site, which intentionally does not pass this check.
  return request.headers.get('sec-fetch-site') === 'same-origin'
}
