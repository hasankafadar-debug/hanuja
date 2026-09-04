import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../api/lib/errors'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  complete: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: mocks.csrf }))
vi.mock('@hanuja/api/lib/rate-limit', () => ({
  checkUserRateLimit: mocks.limit,
  HIGH_RISK_RATE_LIMIT: { max: 5 },
}))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('../../../api/services/quantity-refund.service', () => ({
  createQuantityRefundService: () => ({ complete: mocks.complete }),
}))
import { POST } from '../../../apps/admin-panel/src/app/api/admin/refunds/[id]/complete/route'

const valid = {
  orderId: 'o1',
  providerReference: ' BANK-123 ',
  expectedOutstandingAmount: '38560.50',
  paymentMade: true,
}
function request(body: unknown = valid) {
  return new Request('https://admin.test/api/admin/refunds/r1/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1, proxy' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never
}
const ctx = { params: Promise.resolve({ id: 'r1' }) }

describe('admin manual refund route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'admin-session', role: 'admin' } })
    mocks.csrf.mockReturnValue(null)
    mocks.limit.mockResolvedValue({ allowed: true, response: null })
    mocks.complete.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      status: 'completed',
      completedAt: new Date(),
      providerReference: 'BANK-123',
      payment: { privateData: 'not returned' },
    })
  })
  it('requires CSRF before authentication or mutation', async () => {
    mocks.csrf.mockReturnValue(new Response(null, { status: 403 }))
    expect((await POST(request(), ctx)).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it.each([null, 'seller', 'customer', 'support', 'unknown'])(
    'rejects unauthorized role %s',
    async (role) => {
      mocks.session.mockResolvedValue(role ? { user: { id: 'u1', role } } : null)
      expect((await POST(request(), ctx)).status).toBe(role ? 403 : 401)
      expect(mocks.complete).not.toHaveBeenCalled()
      expect(mocks.limit).not.toHaveBeenCalled()
    },
  )
  it('rate-limits financial submissions', async () => {
    mocks.limit.mockResolvedValue({ allowed: false, response: new Response(null, { status: 429 }) })
    expect((await POST(request(), ctx)).status).toBe(429)
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it.each([
    { ...valid, providerReference: '  ' },
    { ...valid, providerReference: 'x'.repeat(201) },
    { ...valid, paymentMade: false },
    { ...valid, expectedOutstandingAmount: '-1.00' },
    { ...valid, expectedOutstandingAmount: '38560.501' },
    { ...valid, orderId: '' },
    '{broken',
  ])('rejects malformed or unconfirmed input %j', async (body) => {
    expect((await POST(request(body), ctx)).status).toBe(422)
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('binds the actor to session, passes exact expected amount, returns minimal data and refreshes all admin views', async () => {
    const response = await POST(request({ ...valid, actorId: 'spoofed' }), ctx)
    expect(response.status).toBe(200)
    expect(mocks.complete).toHaveBeenCalledWith({
      refundTransactionId: 'r1',
      orderId: 'o1',
      providerReference: 'BANK-123',
      expectedOutstandingAmount: '38560.50',
      actorId: 'admin-session',
      ipAddress: '127.0.0.1',
    })
    expect((await response.json()).data.payment).toBeUndefined()
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual([
      '/siparisler/o1',
      '/iadeler',
      '/dashboard',
    ])
  })
  it('preserves conflicts without invalidating queues or returning success', async () => {
    mocks.complete.mockRejectedValueOnce(new ConflictError('İade tutarı değişmiş.'))
    const response = await POST(request(), ctx)
    expect(response.status).toBe(409)
    expect((await response.json()).message).toContain('tutarı değişmiş')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
