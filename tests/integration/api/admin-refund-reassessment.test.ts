import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../api/lib/errors'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  reassess: vi.fn(),
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
vi.mock('../../../api/services/refund.service', () => ({
  createRefundService: () => ({ reassessLegacyRefund: mocks.reassess }),
}))
import { POST } from '../../../apps/admin-panel/src/app/api/admin/refunds/[id]/reassess/route'
const valid = {
  reason: 'Original payment evidence verified',
  expectedUpdatedAt: '2026-09-16T10:00:00.000Z',
}
const request = (body: unknown = valid) =>
  new Request('https://admin.test/api/admin/refunds/r1/reassess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
const ctx = { params: Promise.resolve({ id: 'r1' }) }
describe('legacy refund reassessment authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } })
    mocks.csrf.mockReturnValue(null)
    mocks.limit.mockResolvedValue({ allowed: true })
    mocks.reassess.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      status: 'manual_required',
    })
  })
  it.each([null, 'seller', 'customer', 'support'])('rejects unauthorized role %s', async (role) => {
    mocks.session.mockResolvedValue(role ? { user: { id: 'u1', role } } : null)
    expect((await POST(request(), ctx)).status).toBe(role ? 403 : 401)
    expect(mocks.reassess).not.toHaveBeenCalled()
  })
  it('rejects CSRF before reading session', async () => {
    mocks.csrf.mockReturnValue(new Response(null, { status: 403 }))
    expect((await POST(request(), ctx)).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
  })
  it('rate limits reassessment', async () => {
    mocks.limit.mockResolvedValue({
      allowed: false,
      response: new Response(null, { status: 429 }),
    })
    expect((await POST(request(), ctx)).status).toBe(429)
    expect(mocks.reassess).not.toHaveBeenCalled()
  })
  it.each([
    { ...valid, reason: '' },
    { ...valid, expectedUpdatedAt: 'invalid' },
  ])('validates the review %j', async (body) => {
    expect((await POST(request(body), ctx)).status).toBe(422)
    expect(mocks.reassess).not.toHaveBeenCalled()
  })
  it('binds actor to the session and never accepts a client money amount', async () => {
    expect(
      (await POST(request({ ...valid, actorId: 'spoofed', customerAmount: '50000' }), ctx)).status,
    ).toBe(200)
    expect(mocks.reassess).toHaveBeenCalledWith({
      refundId: 'r1',
      actorId: 'admin1',
      ...valid,
    })
  })
  it('returns conflict when evidence remains insufficient', async () => {
    mocks.reassess.mockRejectedValue(new ConflictError('Eksik kanıt'))
    expect((await POST(request(), ctx)).status).toBe(409)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
