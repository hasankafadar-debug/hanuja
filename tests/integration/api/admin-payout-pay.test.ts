/**
 * Integration test — admin payout release route.
 * Auth boundaries + transfer snapshot persistence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  releasePayoutMock,
  paymentContextMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  releasePayoutMock: vi.fn(),
  paymentContextMock: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))

vi.mock('@hanuja/api/routes/payouts', () => ({
  releasePayout: releasePayoutMock,
  getPayoutPaymentContext: paymentContextMock,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  releasePayoutMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  paymentContextMock.mockResolvedValue(new Response(JSON.stringify({ amount: '820.00', snapshot: 'fresh' }), { status: 200 }))
})

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/payouts/p1/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof import('../../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route').POST>[0]
}

const ctx = { params: Promise.resolve({ id: 'p1' }) }

describe('GET payout payment context — authorization', () => {
  it.each([
    [null, 401],
    [{ user: { id: 'seller-1', role: 'seller' } }, 403],
    [{ user: { id: 'admin-1', role: 'admin' } }, 200],
  ])('only an authorized administrator can read bank and amount details', async (session, status) => {
    getSessionMock.mockResolvedValue(session)
    const route = await import('../../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route')
    const response = await route.GET(buildRequest({}), ctx)
    expect(response.status).toBe(status)
    expect(paymentContextMock).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
  })
})

describe('POST /api/admin/payouts/[id]/release — auth', () => {
  it('returns 401 when no session present', async () => {
    getSessionMock.mockResolvedValue(null)
    const route = await import('../../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route')
    const response = await route.POST(buildRequest({}), ctx)
    expect(response.status).toBe(401)
    expect(releasePayoutMock).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin users', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', role: 'seller' } })
    const route = await import('../../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route')
    const response = await route.POST(buildRequest({}), ctx)
    expect(response.status).toBe(403)
    expect(releasePayoutMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/payouts/[id]/release — happy path', () => {
  it('forwards transfer snapshot fields to releasePayout', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })

    const body = {
      transferDate: '2026-05-09T12:00:00.000Z',
      transferReference: 'EFT-12345',
      transferBankName: 'Garanti BBVA',
      transferNote: 'Mayis donemi odeme',
    }

    const route = await import('../../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route')
    const response = await route.POST(buildRequest(body), ctx)
    expect(response.status).toBe(200)

    expect(releasePayoutMock).toHaveBeenCalledTimes(1)
    const [, payoutId, adminActorId] = releasePayoutMock.mock.calls[0] as [unknown, string, string]
    expect(payoutId).toBe('p1')
    expect(adminActorId).toBe('admin-1')
  })
})
