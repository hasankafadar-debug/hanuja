import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstileToken } from '../../api/lib/turnstile'

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
}

afterEach(() => {
  process.env.NODE_ENV = originalEnv.NODE_ENV
  process.env.TURNSTILE_SECRET_KEY = originalEnv.TURNSTILE_SECRET_KEY
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

  it('retries one network failure with the same idempotency key and a five-second timeout', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.useFakeTimers()

    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, action: 'customer-login' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = verifyTurnstileToken({
      token: 'real-token',
      action: 'customer-login',
    })
    await vi.advanceTimersByTimeAsync(250)
    const result = await resultPromise

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(timeoutSpy).toHaveBeenCalledTimes(2)
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 5_000)
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 5_000)

    const firstBody = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams
    const secondBody = fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams
    expect(firstBody.get('idempotency_key')).toBeTruthy()
    expect(secondBody.get('idempotency_key')).toBe(firstBody.get('idempotency_key'))
  })

  it('fails closed after two network failures', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = verifyTurnstileToken({ token: 'real-token' })
    await vi.advanceTimersByTimeAsync(250)
    const result = await resultPromise

    expect(result.success).toBe(false)
    expect(result.message).toContain('dogrulanamadi')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([429, 500, 503])('retries a retriable HTTP %s response once', async (status) => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = verifyTurnstileToken({ token: 'real-token' })
    await vi.advanceTimersByTimeAsync(250)
    const result = await resultPromise

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an invalid token response', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstileToken({ token: 'invalid-token' })

    expect(result.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a non-retriable HTTP response', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstileToken({ token: 'real-token' })

    expect(result.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
