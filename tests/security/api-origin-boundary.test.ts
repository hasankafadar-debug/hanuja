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
