import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTurnstileFailureContract, verifyTurnstileToken } from '../../api/lib/turnstile'

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
}

const baseOptions = {
  action: 'checkout-submit',
  surface: 'checkout',
  token: 'real-token',
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
      ...baseOptions,
      token: 'dev-turnstile-bypass',
    })

    expect(result).toEqual({ success: true })
  })

  it('classifies a missing token without contacting Cloudflare', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstileToken({ ...baseOptions, token: ' ' })

    expect(result).toMatchObject({ success: false, reason: 'required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed as misconfigured when the secret key is missing', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TURNSTILE_SECRET_KEY

    const result = await verifyTurnstileToken(baseOptions)

    expect(result).toMatchObject({ success: false, reason: 'misconfigured' })
  })

  it('fails closed in production when a Cloudflare test secret key is configured', async () => {
    process.env.NODE_ENV = 'production'
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA'

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstileToken(baseOptions)

    expect(result).toMatchObject({ success: false, reason: 'misconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a valid response when the action does not match', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true, action: 'seller-onboarding' }),
      }),
    )

    const result = await verifyTurnstileToken(baseOptions)

    expect(result).toMatchObject({ success: false, reason: 'action_mismatch' })
  })

  it('retries two network failures with one idempotency key and four-second timeouts', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.useFakeTimers()

    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ETIMEDOUT' },
        }),
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-ray': 'safe-ray-id' }),
        json: async () => ({ success: true, action: 'checkout-submit' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = verifyTurnstileToken(baseOptions)
    await vi.advanceTimersByTimeAsync(750)
    const result = await resultPromise

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(timeoutSpy).toHaveBeenCalledTimes(3)
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 4_000)
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 4_000)
    expect(timeoutSpy).toHaveBeenNthCalledWith(3, 4_000)

    const bodies = fetchMock.mock.calls.map((call) => call[1]?.body as URLSearchParams)
    const idempotencyKeys = bodies.map((body) => body.get('idempotency_key'))
    expect(idempotencyKeys[0]).toBeTruthy()
    expect(new Set(idempotencyKeys).size).toBe(1)
  })

  it('fails closed after three network failures', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = verifyTurnstileToken(baseOptions)
    await vi.advanceTimersByTimeAsync(750)
    const result = await resultPromise

    expect(result).toMatchObject({
      success: false,
      reason: 'provider_unavailable',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([429, 500, 503])('retries a retriable HTTP %s response', async (status) => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status, headers: new Headers() })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true, action: 'checkout-submit' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = verifyTurnstileToken(baseOptions)
    await vi.advanceTimersByTimeAsync(250)
    const result = await resultPromise

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries Cloudflare internal-error and classifies a persistent failure as unavailable', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: false, 'error-codes': ['internal-error'] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = verifyTurnstileToken(baseOptions)
    await vi.advanceTimersByTimeAsync(750)
    const result = await resultPromise

    expect(result).toMatchObject({
      success: false,
      reason: 'provider_unavailable',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['invalid-input-response', 'invalid'],
    ['timeout-or-duplicate', 'expired_or_duplicate'],
    ['missing-input-response', 'required'],
    ['invalid-input-secret', 'misconfigured'],
  ])('does not retry Cloudflare %s', async (errorCode, reason) => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: false, 'error-codes': [errorCode] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstileToken(baseOptions)

    expect(result).toMatchObject({ success: false, reason })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a non-retriable HTTP response', async () => {
    process.env.NODE_ENV = 'test'
    process.env.TURNSTILE_SECRET_KEY = 'secret'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTurnstileToken(baseOptions)

    expect(result).toMatchObject({ success: false, reason: 'invalid' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('getTurnstileFailureContract', () => {
  it.each([
    ['required', 400, 'TURNSTILE_REQUIRED'],
    ['invalid', 403, 'TURNSTILE_INVALID'],
    ['expired_or_duplicate', 403, 'TURNSTILE_INVALID'],
    ['action_mismatch', 403, 'TURNSTILE_INVALID'],
    ['provider_unavailable', 503, 'TURNSTILE_UNAVAILABLE'],
    ['misconfigured', 503, 'TURNSTILE_MISCONFIGURED'],
  ] as const)('maps %s to the public HTTP contract', (reason, status, code) => {
    const contract = getTurnstileFailureContract({
      success: false,
      reason,
      message: 'safe message',
    })

    expect(contract).toEqual({
      status,
      body: { code, message: 'safe message' },
    })
  })
})
