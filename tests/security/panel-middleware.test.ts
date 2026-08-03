import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

import {
  config as adminConfig,
  middleware as adminMiddleware,
} from '../../apps/admin-panel/src/middleware'
import {
  config as sellerConfig,
  isPublicPath,
  middleware as sellerMiddleware,
} from '../../apps/seller-panel/src/middleware'

const ORIGIN = 'https://panel.hanuja.com.tr'

function request(pathname: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}${pathname}`, {
    ...(cookie ? { headers: { cookie } } : {}),
  })
}

function expectPanelSecurityHeaders(response: Response) {
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'")
}

function mockSession(
  user: {
    id: string
    email: string
    role: string
    mustChangePassword?: boolean
  } | null,
) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(user ? { user } : null), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function expectInternalSessionFetch(port: 3001 | 3002) {
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
    `http://127.0.0.1:${port}/api/auth/get-session`,
  )
}

describe('active panel middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('matches seller and media APIs without matching auth APIs', () => {
    expect(adminConfig.matcher).toEqual([
      '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ])
    expect(sellerConfig.matcher).toEqual([
      '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
      '/api/seller/:path*',
      '/api/media/:path*',
    ])
  })

  it('sets stable double-submit CSRF cookies and clickjacking protections on an admin public route', async () => {
    const response = await adminMiddleware(request('/giris'))

    expect(response.status).toBe(200)
    expectPanelSecurityHeaders(response)
    expect(response.cookies.get('hanuja-csrf')).toMatchObject({
      value: expect.stringMatching(/^[0-9a-f]{64}$/),
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    })
    expect(response.cookies.get('hanuja-csrf-mirror')).toMatchObject({
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not rotate an existing CSRF token', async () => {
    const response = await sellerMiddleware(
      request('/giris', 'hanuja-csrf=stable; hanuja-csrf-mirror=stable'),
    )

    expect(response.cookies.get('hanuja-csrf')).toBeUndefined()
    expect(response.cookies.get('hanuja-csrf-mirror')).toBeUndefined()
  })

  it('redirects an anonymous admin-panel visitor to login', async () => {
    mockSession(null)

    const response = await adminMiddleware(request('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/giris`)
    expectPanelSecurityHeaders(response)
  })

  it('denies a non-admin from protected admin pages', async () => {
    mockSession({ id: 'seller-1', email: 'seller@example.test', role: 'seller' })

    const response = await adminMiddleware(request('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/giris?error=unauthorized`)
  })

  it('allows an admin through the active admin middleware', async () => {
    mockSession({ id: 'admin-1', email: 'admin@example.test', role: 'admin' })

    const response = await adminMiddleware(request('/dashboard'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expectPanelSecurityHeaders(response)
    expectInternalSessionFetch(3002)
  })

  it('keeps only exact seller public routes and recovery APIs public', async () => {
    expect(isPublicPath('/basvuru')).toBe(true)
    expect(isPublicPath('/basvuru/belgeler')).toBe(false)
    expect(isPublicPath('/sifre-olustur')).toBe(true)
    expect(isPublicPath('/api/seller/first-password')).toBe(true)

    const response = await sellerMiddleware(request('/api/seller/first-password'))
    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redirects anonymous seller-panel visitors to login with a callback path', async () => {
    mockSession(null)

    const response = await sellerMiddleware(request('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/giris?callbackUrl=%2Fdashboard`)
  })

  it('redirects customer and unknown roles away from protected seller pages', async () => {
    mockSession({ id: 'customer-1', email: 'customer@example.test', role: 'customer' })
    const customerResponse = await sellerMiddleware(request('/dashboard'))
    expect(customerResponse.headers.get('location')).toBe(`${ORIGIN}/basvuru`)

    mockSession({ id: 'unknown-1', email: 'unknown@example.test', role: 'unknown' })
    const unknownResponse = await sellerMiddleware(request('/dashboard'))
    expect(unknownResponse.headers.get('location')).toBe(`${ORIGIN}/giris?error=unauthorized`)
  })

  it('forces a seller with mustChangePassword to the first-password page', async () => {
    mockSession({
      id: 'seller-1',
      email: 'seller@example.test',
      role: 'seller',
      mustChangePassword: true,
    })

    const response = await sellerMiddleware(request('/dashboard'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/sifre-olustur`)
    expectPanelSecurityHeaders(response)
  })

  it.each(['/api/seller/profile', '/api/media/fetch'])(
    'returns JSON 403 for a temporary-password seller requesting %s',
    async (pathname) => {
      mockSession({
        id: 'seller-1',
        email: 'seller@example.test',
        role: 'seller',
        mustChangePassword: true,
      })

      const response = await sellerMiddleware(request(pathname))

      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(response.headers.get('location')).toBeNull()
      await expect(response.json()).resolves.toEqual({
        error: 'Yeni şifrenizi oluşturmadan bu işlem yapılamaz.',
      })
    },
  )

  it('allows first-password recovery for a temporary-password seller', async () => {
    mockSession({
      id: 'seller-1',
      email: 'seller@example.test',
      role: 'seller',
      mustChangePassword: true,
    })

    const response = await sellerMiddleware(request('/api/seller/first-password'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes normal seller API requests through to route-level authorization', async () => {
    mockSession({ id: 'seller-1', email: 'seller@example.test', role: 'seller' })

    const response = await sellerMiddleware(request('/api/seller/profile'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('allows seller and admin roles through the seller panel after policy checks', async () => {
    for (const role of ['seller', 'admin']) {
      mockSession({ id: `${role}-1`, email: `${role}@example.test`, role })

      const response = await sellerMiddleware(request('/dashboard'))
      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
      expectInternalSessionFetch(3001)
      fetchMock.mockClear()
    }
  })

  it('does not use the external request origin for panel session checks', async () => {
    mockSession({ id: 'admin-1', email: 'admin@example.test', role: 'admin' })

    await adminMiddleware(new NextRequest('https://untrusted.example/dashboard'))

    expectInternalSessionFetch(3002)
  })
})
