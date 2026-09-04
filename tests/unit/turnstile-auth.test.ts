import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstileAuthRequest } from '../../api/lib/turnstile-auth'

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
}

const rules = {
  '/sign-in/email': { action: 'customer-login', surface: 'web-auth' },
  '/sign-up/email': { action: 'customer-signup', surface: 'web-auth' },
} as const

afterEach(() => {
  process.env.NODE_ENV = originalEnv.NODE_ENV
  process.env.TURNSTILE_SECRET_KEY = originalEnv.TURNSTILE_SECRET_KEY
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('verifyTurnstileAuthRequest', () => {
  it('blocks direct email sign-in requests without a Turnstile token', async () => {
    const response = await verifyTurnstileAuthRequest(
      new Request('https://hanuja.example/api/auth/sign-in/email', {
        method: 'POST',
      }),
      rules,
    )

    expect(response?.status).toBe(400)
    await expect(response?.json()).resolves.toMatchObject({
      code: 'TURNSTILE_REQUIRED',
    })
  })

  it('blocks direct email sign-up requests without a Turnstile token', async () => {
    const response = await verifyTurnstileAuthRequest(
      new Request('https://hanuja.example/api/auth/sign-up/email', {
        method: 'POST',
      }),
      rules,
    )

    expect(response?.status).toBe(400)
    await expect(response?.json()).resolves.toMatchObject({
      code: 'TURNSTILE_REQUIRED',
    })
  })

  it('allows a development bypass token on protected auth requests', async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.TURNSTILE_SECRET_KEY

    const response = await verifyTurnstileAuthRequest(
      new Request('https://hanuja.example/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'x-captcha-response': 'dev-turnstile-bypass' },
      }),
      rules,
    )

    expect(response).toBeNull()
  })

  it('does not apply a sign-in rule to sign-up when sign-up is intentionally absent', async () => {
    const response = await verifyTurnstileAuthRequest(
      new Request('https://admin.hanuja.example/api/auth/sign-up/email', {
        method: 'POST',
      }),
      {
        '/sign-in/email': { action: 'admin-login', surface: 'admin-auth' },
      },
    )

    expect(response).toBeNull()
  })

  it('ignores non-credential auth routes and GET requests', async () => {
    const sessionResponse = await verifyTurnstileAuthRequest(
      new Request('https://hanuja.example/api/auth/get-session'),
      rules,
    )
    const socialResponse = await verifyTurnstileAuthRequest(
      new Request('https://hanuja.example/api/auth/sign-in/social', {
        method: 'POST',
      }),
      rules,
    )

    expect(sessionResponse).toBeNull()
    expect(socialResponse).toBeNull()
  })
})
