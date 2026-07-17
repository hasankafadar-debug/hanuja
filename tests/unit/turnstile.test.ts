import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstileToken } from '../../api/lib/turnstile'

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
}

afterEach(() => {
  process.env.NODE_ENV = originalEnv.NODE_ENV
  process.env.TURNSTILE_SECRET_KEY = originalEnv.TURNSTILE_SECRET_KEY
  vi.restoreAllMocks()
})

describe('verifyTurnstileToken', () => {
  it('allows the development bypass token when no secret is configured', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.TURNSTILE_SECRET_KEY

    const result = await verifyTurnstileToken({
      token: 'dev-turnstile-bypass',
      action: 'checkout-submit',
    })

    expect(result).toEqual({ success: true })
  })

  it('fails closed in production when the secret key is missing', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TURNSTILE_SECRET_KEY

    const result = await verifyTurnstileToken({
      token: 'any-token',
      action: 'checkout-submit',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('hazir degil')
  })

  it('fails closed in production when a Cloudflare test secret key is configured', async () => {
    process.env.NODE_ENV = 'production'
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA'

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstileToken({
      token: 'XXXX.DUMMY.TOKEN.XXXX',
      action: 'checkout-submit',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('hazir degil')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a valid response when the action does not match', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          action: 'seller-onboarding',
        }),
      }),
    )

    const result = await verifyTurnstileToken({
      token: 'real-token',
      action: 'checkout-submit',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('gecersiz')
  })

  it('rejects a response without the expected action', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      }),
    )

    const result = await verifyTurnstileToken({
      token: 'real-token',
      action: 'checkout-submit',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('gecersiz')
  })
})
