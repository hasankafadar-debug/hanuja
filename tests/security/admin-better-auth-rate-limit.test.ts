import { describe, expect, it } from 'vitest'
import { getTestInstance } from '../../apps/admin-panel/node_modules/better-auth/dist/test-utils/index.mjs'
import { ADMIN_AUTH_RATE_LIMIT } from '../../apps/admin-panel/src/lib/auth-rate-limit'

function request(path: string, forwardedIp: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('x-forwarded-for', forwardedIp)

  return new Request(`http://localhost:3000/api/auth${path}`, {
    ...init,
    headers,
  })
}

async function repeatedStatuses(
  auth: { handler: (req: Request) => Promise<Response> },
  path: string,
  forwardedIp: string,
  count: number,
  init?: RequestInit,
) {
  const statuses: number[] = []

  for (let index = 0; index < count; index++) {
    const response = await auth.handler(request(path, forwardedIp, init))
    statuses.push(response.status)
  }

  return statuses
}

describe('Better Auth rate limiting (deployed admin policy)', () => {
  it('keeps loopback get-session reads available without weakening write limits', async () => {
    const { auth } = await getTestInstance(
      { rateLimit: ADMIN_AUTH_RATE_LIMIT },
      { disableTestUser: true },
    )

    const getSessionStatuses = await repeatedStatuses(
      auth,
      '/get-session',
      '127.0.0.1',
      80,
      { headers: { cookie: 'hanuja-admin-session-v2.session_token=invalid' } },
    )
    expect(getSessionStatuses.every((status) => status === 200)).toBe(true)

    const signInStatuses = await repeatedStatuses(auth, '/sign-in/email', '10.0.0.10', 4, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'nobody@example.test',
        password: 'wrong-password-123',
      }),
    })
    expect(signInStatuses[3]).toBe(429)

    const changePasswordStatuses = await repeatedStatuses(
      auth,
      '/change-password',
      '10.0.0.11',
      6,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'old-password-123',
          newPassword: 'new-password-123',
          revokeOtherSessions: true,
        }),
      },
    )
    expect(changePasswordStatuses.slice(0, 5).every((status) => status !== 429)).toBe(true)
    expect(changePasswordStatuses[5]).toBe(429)
  })
})
