import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../apps/web/src/middleware'

describe('storefront middleware', () => {
  it.each(['/hesabim', '/hesabim/adresler', '/faturalarim', '/siparis', '/siparis/order-1'])(
    'redirects anonymous access to %s with the original callback path',
    async (pathname) => {
      const response = await middleware(new NextRequest(`https://www.hanuja.com.tr${pathname}`))

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(
        `https://www.hanuja.com.tr/giris?callbackUrl=${encodeURIComponent(pathname)}`,
      )
    },
  )

  it.each(['better-auth.session_token', '__Secure-better-auth.session_token'])(
    'lets a request carrying the %s cookie reach server-side session validation',
    async (cookieName) => {
      const request = new NextRequest('https://www.hanuja.com.tr/faturalarim', {
        headers: { cookie: `${cookieName}=test-session` },
      })

      const response = await middleware(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    },
  )

  it('does not treat similarly prefixed public paths as account routes', async () => {
    const response = await middleware(
      new NextRequest('https://www.hanuja.com.tr/hesabim-hakkinda'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
})
