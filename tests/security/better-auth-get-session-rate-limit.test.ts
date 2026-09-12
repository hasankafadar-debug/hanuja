import { describe, expect, it } from 'vitest'
import { getTestInstance } from '../../apps/seller-panel/node_modules/better-auth/dist/test-utils/index.mjs'

/**
 * Mechanism test for the seller-panel "logged out while navigating" bug.
 *
 * The seller-panel middleware asks its own Better Auth instance for the
 * session over loopback on every page navigation. Next.js fills
 * x-forwarded-for with the socket address on that hop, so every seller's
 * navigation lands in ONE rate-limit bucket (`<ip>|/get-session`). With the
 * seller config (`window: 60, max: 60`, see apps/seller-panel/src/lib/auth.ts)
 * the 61st navigation in a minute answered 429 and the middleware read that
 * as "no session".
 *
 * The forwarded IP is fixed per test below to model that shared bucket; the
 * cookie (i.e. which seller) is irrelevant to the key.
 */

const SELLER_RATE_LIMIT = { enabled: true, window: 60, max: 60 } as const

function getSession(forwardedIp: string, cookie: string) {
  return new Request('http://localhost:3000/api/auth/get-session', {
    headers: { 'x-forwarded-for': forwardedIp, cookie },
  })
}

async function statusesFor(
  auth: { handler: (req: Request) => Promise<Response> },
  forwardedIp: string,
  count: number,
) {
  const statuses: number[] = []
  for (let i = 0; i < count; i++) {
    // Alternate cookies: two different "sellers" behind the same hop.
    const cookie = i % 2 === 0 ? 'hanuja-seller-session-v2.session_token=a' : 'hanuja-seller-session-v2.session_token=b'
    const response = await auth.handler(getSession(forwardedIp, cookie))
    statuses.push(response.status)
  }
  return statuses
}

describe('Better Auth get-session rate limiting (seller panel config)', () => {
  it('reproduces the bug: a shared bucket answers 429 from the 61st get-session call', async () => {
    const { auth } = await getTestInstance(
      { rateLimit: { ...SELLER_RATE_LIMIT } },
      { disableTestUser: true },
    )

    const statuses = await statusesFor(auth, '10.0.0.1', 62)

    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
    expect(statuses[61]).toBe(429)

    const limited = await auth.handler(getSession('10.0.0.1', 'hanuja-seller-session-v2.session_token=c'))
    await expect(limited.json()).resolves.toEqual({
      message: 'Too many requests. Please try again later.',
    })
  })

  it('exempting /get-session keeps every call at 200 while other limits stay on', async () => {
    const { auth } = await getTestInstance(
      {
        rateLimit: {
          ...SELLER_RATE_LIMIT,
          customRules: {
            '/change-password': { window: 60, max: 5 },
            '/get-session': false,
          },
        },
      },
      { disableTestUser: true },
    )

    const statuses = await statusesFor(auth, '10.0.0.2', 80)
    expect(statuses.every((status) => status === 200)).toBe(true)

    // Control: the built-in sign-in rule (3 per 10 s) is still enforced.
    const signInStatuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const response = await auth.handler(
        new Request('http://localhost:3000/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '10.0.0.2',
          },
          body: JSON.stringify({ email: 'nobody@example.test', password: 'wrong-password-123' }),
        }),
      )
      signInStatuses.push(response.status)
    }
    expect(signInStatuses[3]).toBe(429)
  })
})
