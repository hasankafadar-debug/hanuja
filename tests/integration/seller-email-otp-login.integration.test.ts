import { describe, expect, it } from 'vitest'
import { parseSetCookieHeader } from '../../apps/seller-panel/node_modules/better-auth/dist/cookies/index.mjs'
import { getTestInstance } from '../../apps/seller-panel/node_modules/better-auth/dist/test-utils/index.mjs'
import { twoFactor } from '../../apps/seller-panel/node_modules/better-auth/dist/plugins/two-factor/index.mjs'

function jsonRequest(path: string, body: Record<string, unknown>, cookie?: string) {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

function cookieFromResponse(response: Response, suffix: string): string {
  const cookies = parseSetCookieHeader(response.headers.get('set-cookie') ?? '')
  const entry = Array.from(cookies.entries()).find(([name]) => name.endsWith(suffix))
  if (!entry) throw new Error(`Expected ${suffix} cookie`)
  return `${entry[0]}=${entry[1].value}`
}

describe('Better Auth seller email OTP sign-in', () => {
  it('creates a session after password and the captured email code are verified', async () => {
    let deliveredOtp: string | null = null
    const { auth } = await getTestInstance(
      {
        plugins: [
          twoFactor({
            totpOptions: { disable: true },
            otpOptions: {
              digits: 6,
              period: 10,
              allowedAttempts: 3,
              storeOTP: 'hashed',
              sendOTP: async ({ otp }) => {
                deliveredOtp = otp
              },
            },
          }),
        ],
      },
      { disableTestUser: true },
    )
    const email = 'seller-otp-integration@example.test'
    const password = 'IntegrationTestPassword123!'

    const signUpResponse = await auth.handler(
      jsonRequest('/sign-up/email', {
        email,
        password,
        name: 'Seller OTP Integration',
      }),
    )
    expect(signUpResponse.status).toBe(200)

    const context = await auth.$context
    const found = await context.internalAdapter.findUserByEmail(email)
    expect(found?.user.id).toBeTruthy()
    const userId = found!.user.id

    await context.internalAdapter.updateUser(userId, {
      twoFactorEnabled: true,
    })
    await context.adapter.create({
      model: 'twoFactor',
      data: {
        userId,
        secret: 'seller-email-otp-only-v1',
        backupCodes: '[]',
        verified: false,
        failedVerificationCount: 0,
      },
    })

    const passwordResponse = await auth.handler(
      jsonRequest('/sign-in/email', {
        email,
        password,
        rememberMe: false,
      }),
    )
    expect(passwordResponse.status).toBe(200)
    await expect(passwordResponse.json()).resolves.toMatchObject({
      twoFactorRedirect: true,
      twoFactorMethods: ['otp'],
    })
    const challengeCookie = cookieFromResponse(
      passwordResponse,
      '.two_factor',
    )

    const sendResponse = await auth.handler(
      jsonRequest('/two-factor/send-otp', { trustDevice: false }, challengeCookie),
    )
    expect(sendResponse.status).toBe(200)
    expect(deliveredOtp).toMatch(/^\d{6}$/)

    const verifyResponse = await auth.handler(
      jsonRequest(
        '/two-factor/verify-otp',
        {
          code: deliveredOtp,
          trustDevice: false,
        },
        challengeCookie,
      ),
    )
    expect(verifyResponse.status).toBe(200)
    const verified = await verifyResponse.clone().json()
    expect(verified.user.id).toBe(userId)
    const sessionCookie = cookieFromResponse(verifyResponse, '.session_token')

    const sessionResponse = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', {
        headers: { cookie: sessionCookie },
      }),
    )
    expect(sessionResponse.status).toBe(200)
    await expect(sessionResponse.json()).resolves.toMatchObject({
      user: { id: userId },
    })
  })
})
