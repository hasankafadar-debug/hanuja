import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware as adminMiddleware } from '../../apps/admin-panel/src/middleware'
import { middleware as sellerMiddleware } from '../../apps/seller-panel/src/middleware'
import { middleware as webMiddleware } from '../../apps/web/src/middleware'

const origin = 'https://app.example.test'
const surfaces = [
  ['admin', adminMiddleware, '/api/admin/disputes/case/resolve'],
  ['seller', sellerMiddleware, '/api/seller/products/item'],
  ['web', webMiddleware, '/api/orders/order/cancel'],
] as const

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BETTER_AUTH_URL', origin)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(null)))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe.each(surfaces)('%s API origin boundary', (_name, middleware, path) => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects sibling-site %s before any session/network call', async method => {
    const response = await middleware(new NextRequest(`${origin}${path}`, {
      method, headers: { origin: 'https://sibling.example.test', 'sec-fetch-site': 'same-site' },
    }))
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{}, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }])('rejects absent/untrusted browser metadata: %s', async headers => {
    const response = await middleware(new NextRequest(`${origin}${path}`, { method: 'POST', headers }))
    expect(response.status).toBe(403)
  })
  it.each([{ origin }, { 'sec-fetch-site': 'same-origin' }])('preserves same-origin browser mutations: %s', async headers => {
    const response = await middleware(new NextRequest(`${origin}${path}`, { method: 'POST', headers }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
  it('does not weaken the canonical origin with forwarded host headers', async () => {
    const response = await middleware(new NextRequest(`${origin}${path}`, {
      method: 'POST', headers: { origin: 'https://attacker.example.test', 'x-forwarded-host': 'attacker.example.test' },
    }))
    expect(response.status).toBe(403)
  })
  it('preserves safe API reads', async () => {
    const response = await middleware(new NextRequest(`${origin}${path}`))
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})

it.each(['/api/payment/callback', '/api/webhooks/iyzico', '/api/webhooks/resend', '/api/inbound/postmark', '/api/inbound/postmark/store-discount'])(
  'leaves provider authentication to its existing handler: %s', async path => {
    const response = await webMiddleware(new NextRequest(`${origin}${path}`, { method: 'POST' }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
  },
)

it('does not exempt arbitrary webhook names', async () => {
  expect((await webMiddleware(new NextRequest(`${origin}/api/webhooks/attacker`, { method: 'POST' }))).status).toBe(403)
})

// RFC 8058: Gmail/Yahoo/Outlook POST the List-Unsubscribe URL from their own
// servers, so the request carries neither Origin nor Fetch Metadata.
describe('one-click unsubscribe from a mail provider', () => {
  const oneClick = (path: string) => new NextRequest(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  })

  it('reaches the token-checked handler without browser metadata', async () => {
    const response = await webMiddleware(oneClick('/api/marketing/unsubscribe?token=opt-out-token'))
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it.each(['/api/marketing/unsubscribe/extra', '/api/user/marketing-consent', '/api/marketing'])(
    'keeps neighbouring paths behind the origin check: %s', async path => {
      expect((await webMiddleware(oneClick(path))).status).toBe(403)
    },
  )
})

describe.each(surfaces)('%s canonical origin normalisation', (_name, middleware, path) => {
  it.each([`${origin}/`, `${origin}/api/auth`])('accepts the same browser origin when BETTER_AUTH_URL is %s', async configured => {
    vi.stubEnv('BETTER_AUTH_URL', configured)
    const response = await middleware(new NextRequest(`${origin}${path}`, { method: 'POST', headers: { origin } }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})

describe.each([
  ['admin', adminMiddleware],
  ['seller', sellerMiddleware],
] as const)('%s auth API now inside the matcher', (_name, middleware) => {
  it('lets a same-origin sign-in through without a session loopback', async () => {
    const response = await middleware(new NextRequest(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { origin } }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lets the loopback get-session read through without recursing', async () => {
    const response = await middleware(new NextRequest(`${origin}/api/auth/get-session`))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin sign-in', async () => {
    const response = await middleware(new NextRequest(`${origin}/api/auth/sign-in/email`, {
      method: 'POST', headers: { origin: 'https://attacker.example.test' },
    }))
    expect(response.status).toBe(403)
  })
})
