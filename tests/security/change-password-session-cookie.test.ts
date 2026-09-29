/**
 * Changing the password with `revokeOtherSessions: true` deletes every session of the user —
 * including the one making the request — and Better Auth issues a replacement session cookie.
 * Server-side `auth.api.*` calls drop response headers unless `returnHeaders: true` is passed, so
 * the change-password routes must forward that cookie. Otherwise the browser keeps a token for a
 * deleted session and is logged out as soon as the 5-minute `session_data` cookie cache expires.
 * .claude/rules/12-production-readiness.md §42
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestInstance } from '../../apps/web/node_modules/better-auth/dist/test-utils/index.mjs'

const { changePasswordMock, checkUserRateLimitMock, getSessionMock, revokeTrustedDevicesMock, sendEmailMock } =
  vi.hoisted(() => ({
    changePasswordMock: vi.fn(),
    checkUserRateLimitMock: vi.fn(),
    getSessionMock: vi.fn(),
    revokeTrustedDevicesMock: vi.fn(),
    sendEmailMock: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock, changePassword: changePasswordMock } },
}))
vi.mock('@hanuja/api/lib/rate-limit', () => ({
  HIGH_RISK_RATE_LIMIT: {},
  checkUserRateLimit: checkUserRateLimitMock,
}))
vi.mock('@hanuja/api/lib/mailer', () => ({ sendEmail: sendEmailMock }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: vi.fn(() => ({})) }))
vi.mock('@hanuja/api/lib/auth-security', () => ({ revokeTrustedDevices: revokeTrustedDevicesMock }))

import { POST as customerChangePassword } from '../../apps/web/src/app/api/user/change-password/route'
import { POST as sellerChangePassword } from '../../apps/seller-panel/src/app/api/seller/change-password/route'
import { POST as adminChangePassword } from '../../apps/admin-panel/src/app/api/admin/change-password/route'

const CURRENT_PASSWORD = 'EskiParola123!'
// Satisfies the customer, seller and admin password policies at once.
const NEW_PASSWORD = 'YeniParola456!'

function cookieHeaderFrom(setCookies: string[]): string {
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

function onlySessionToken(setCookies: string[]): string {
  return cookieHeaderFrom(setCookies.filter((cookie) => cookie.startsWith('better-auth.session_token=')))
}

describe('Better Auth changePassword contract (revokeOtherSessions)', () => {
  async function signedUpUser() {
    const { auth } = await getTestInstance(
      { session: { cookieCache: { enabled: true, maxAge: 60 * 5 } } },
      { disableTestUser: true },
    )
    const email = `change-password-${crypto.randomUUID()}@example.test`
    const signUp = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: CURRENT_PASSWORD, name: 'Parola Testi' }),
      }),
    )
    expect(signUp.status).toBe(200)
    return { auth, setCookies: signUp.headers.getSetCookie() }
  }

  it('revokes the calling session and drops the replacement cookie without returnHeaders', async () => {
    const { auth, setCookies } = await signedUpUser()

    const result = await auth.api.changePassword({
      headers: new Headers({ cookie: cookieHeaderFrom(setCookies) }),
      body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
    })

    expect(result).not.toHaveProperty('headers')
    // The cached session_data cookie still answers for up to 5 minutes…
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: cookieHeaderFrom(setCookies) }) }),
    ).resolves.not.toBeNull()
    // …but the session behind the browser's token is gone.
    await expect(
      auth.api.getSession({
        headers: new Headers({ cookie: onlySessionToken(setCookies) }),
        query: { disableCookieCache: true },
      }),
    ).resolves.toBeNull()
  })

  it('returns the replacement session cookie with returnHeaders: true', async () => {
    const { auth, setCookies } = await signedUpUser()

    const { headers } = await auth.api.changePassword({
      headers: new Headers({ cookie: cookieHeaderFrom(setCookies) }),
      body: { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
      returnHeaders: true,
    })

    const replacement = onlySessionToken(headers.getSetCookie())
    expect(replacement).not.toBe('')
    expect(replacement).not.toBe(onlySessionToken(setCookies))
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: replacement }), query: { disableCookieCache: true } }),
    ).resolves.toMatchObject({ user: { email: expect.stringContaining('@example.test') } })
  })
})

const REPLACEMENT_COOKIES = [
  'better-auth.session_token=new-token.signature; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax',
  'better-auth.session_data=cached-session; Max-Age=300; Path=/; HttpOnly; SameSite=Lax',
]

const routes = [
  { name: 'web /api/user/change-password', role: 'customer', post: customerChangePassword },
  { name: 'seller-panel /api/seller/change-password', role: 'seller', post: sellerChangePassword },
  { name: 'admin-panel /api/admin/change-password', role: 'admin', post: adminChangePassword },
] as const

function changePasswordRequest() {
  const csrfToken = 'a'.repeat(64)
  return new NextRequest('http://localhost:3000/change-password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `hanuja-csrf=${csrfToken}; better-auth.session_token=old-token.signature`,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD }),
  })
}

describe.each(routes)('$name', ({ role, post }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.test', role } })
    checkUserRateLimitMock.mockResolvedValue({ allowed: true, response: null })
    revokeTrustedDevicesMock.mockResolvedValue(undefined)
    sendEmailMock.mockResolvedValue(undefined)
  })

  it('forwards the replacement session cookie to the browser', async () => {
    const authHeaders = new Headers()
    for (const cookie of REPLACEMENT_COOKIES) authHeaders.append('Set-Cookie', cookie)
    changePasswordMock.mockResolvedValue({ headers: authHeaders, response: { token: 'new-token', user: {} } })

    const response = await post(changePasswordRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(response.headers.getSetCookie()).toEqual(REPLACEMENT_COOKIES)
    expect(changePasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        returnHeaders: true,
        body: expect.objectContaining({ revokeOtherSessions: true }),
      }),
    )
    expect(revokeTrustedDevicesMock).toHaveBeenCalledWith({}, 'user-1')
  })

  it('sets no cookie when the password change fails', async () => {
    changePasswordMock.mockRejectedValue(new Error('INVALID_PASSWORD'))

    const response = await post(changePasswordRequest())

    expect(response.status).toBe(400)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(revokeTrustedDevicesMock).not.toHaveBeenCalled()
  })
})
