import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  seller: vi.fn(),
  report: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: mocks.csrf }))
vi.mock('@hanuja/api/lib/rate-limit', () => ({
  checkRateLimit: mocks.limit,
  API_RATE_LIMIT: {},
}))
vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: () => ({ seller: { findUnique: mocks.seller } }),
}))
vi.mock('../../../api/services/seller-delivery-report.service', () => ({
  createSellerDeliveryReportService: () => ({ report: mocks.report }),
}))
import { POST } from '../../../apps/seller-panel/src/app/api/seller/shipments/report-delivery/route'

const request = () =>
  new Request('https://seller.test/api/seller/shipments/report-delivery', {
    method: 'POST',
    body: JSON.stringify({
      orderId: 'order-1',
      sellerId: 'spoofed',
      actorId: 'spoofed',
    }),
  }) as never
describe('seller delivery report route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.csrf.mockReturnValue(null)
    mocks.limit.mockResolvedValue({ allowed: true })
    mocks.session.mockResolvedValue({ user: { id: 'user-1', role: 'seller' } })
    mocks.seller.mockResolvedValue({ id: 'seller-1', status: 'active' })
    mocks.report.mockResolvedValue({ orderId: 'order-1' })
  })
  it('binds seller and actor to the authenticated account', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.report).toHaveBeenCalledWith({
      orderId: 'order-1',
      sellerId: 'seller-1',
      actorId: 'user-1',
    })
  })
  it('checks CSRF and rate limits before mutation', async () => {
    mocks.csrf.mockReturnValue(new Response(null, { status: 403 }))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
    mocks.csrf.mockReturnValue(null)
    mocks.limit.mockResolvedValue({
      allowed: false,
      response: new Response(null, { status: 429 }),
    })
    expect((await POST(request())).status).toBe(429)
    expect(mocks.report).not.toHaveBeenCalled()
  })
  it.each([null, { id: 'seller-1', status: 'pending' }, { id: 'seller-1', status: 'rejected' }])(
    'rejects unavailable seller accounts',
    async (seller) => {
      mocks.seller.mockResolvedValue(seller)
      expect((await POST(request())).status).toBe(403)
      expect(mocks.report).not.toHaveBeenCalled()
    },
  )
})
