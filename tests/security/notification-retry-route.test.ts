import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateCsrfToken } from '../../packages/security/src/csrf'

const { getSession, retry } = vi.hoisted(() => ({
  getSession: vi.fn(),
  retry: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/services/notification-operations.service', () => ({
  createNotificationOperationsService: () => ({ retry }),
}))
import { POST } from '../../apps/admin-panel/src/app/api/admin/email-deliveries/[id]/retry/route'

const params = { params: Promise.resolve({ id: 'delivery-1' }) }
function request(withCsrf = true, reason = 'SMTP gönderen ayarı düzeltildi') {
  const token = generateCsrfToken()
  return new NextRequest(
    'http://localhost/api/admin/email-deliveries/delivery-1/retry',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withCsrf
          ? { cookie: `hanuja-csrf=${token}`, 'x-csrf-token': token }
          : {}),
      },
      body: JSON.stringify({ kind: 'delivery', reason }),
    },
  )
}
describe('email retry route security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CSRF_STRICT', 'true')
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    retry.mockResolvedValue({ queued: true })
  })
  afterEach(() => vi.unstubAllEnvs())
  it('rejects missing CSRF before querying the session or retrying', async () => {
    expect((await POST(request(false), params)).status).toBe(403)
    expect(getSession).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
  })
  it.each(['customer', 'seller'])(
    'rejects %s even with a valid CSRF token',
    async (role) => {
      getSession.mockResolvedValue({ user: { id: 'user-1', role } })
      expect((await POST(request(), params)).status).toBe(403)
      expect(retry).not.toHaveBeenCalled()
    },
  )
  it('rejects unauthenticated requests', async () => {
    getSession.mockResolvedValue(null)
    expect((await POST(request(), params)).status).toBe(401)
    expect(retry).not.toHaveBeenCalled()
  })
  it('requires an audit reason', async () => {
    expect((await POST(request(true, 'short'), params)).status).toBe(422)
    expect(retry).not.toHaveBeenCalled()
  })
  it('passes the authenticated actor and validated reason to the retry service', async () => {
    expect((await POST(request(), params)).status).toBe(200)
    expect(retry).toHaveBeenCalledWith(
      'admin-1',
      'delivery-1',
      'SMTP gönderen ayarı düzeltildi',
      'delivery',
    )
  })
})
