/**
 * Integration test — admin seller-invoices route.
 * Auth boundaries + service delegation contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  createPrismaForRouteMock,
  createServiceMock,
  invoiceCreateMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  createPrismaForRouteMock: vi.fn(),
  createServiceMock: vi.fn(),
  invoiceCreateMock: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))

vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: createPrismaForRouteMock,
}))

vi.mock('@hanuja/api/services/seller-invoice.service', () => ({
  createSellerInvoiceService: createServiceMock,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  createPrismaForRouteMock.mockReturnValue({})
  createServiceMock.mockReturnValue({ create: invoiceCreateMock })
  invoiceCreateMock.mockResolvedValue({ id: 'inv-1', invoiceNumber: 'F-001' })
})

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/seller-invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  sellerId: 'seller-1',
  type: 'commission' as const,
  invoiceNumber: 'F-001',
  invoiceDate: '2026-05-09T00:00:00.000Z',
  description: 'Sipariş #100 komisyonu',
  amount: '50.00',
  sourceOrderId: 'order-1',
}

describe('POST /api/admin/seller-invoices — auth', () => {
  it('returns 401 without session', async () => {
    getSessionMock.mockResolvedValue(null)
    const route = await import('../../../apps/admin-panel/src/app/api/admin/seller-invoices/route')
    const res = await route.POST(buildRequest(validBody))
    expect(res.status).toBe(401)
    expect(invoiceCreateMock).not.toHaveBeenCalled()
  })

  it('returns 403 for non-admin role', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', role: 'seller' } })
    const route = await import('../../../apps/admin-panel/src/app/api/admin/seller-invoices/route')
    const res = await route.POST(buildRequest(validBody))
    expect(res.status).toBe(403)
    expect(invoiceCreateMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/seller-invoices — happy path', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
  })

  it('delegates commission invoice creation to service with admin actor + order link', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/seller-invoices/route')
    const res = await route.POST(buildRequest(validBody))
    expect(res.status).toBe(200)

    const args = invoiceCreateMock.mock.calls[0]?.[0]
    expect(args.type).toBe('commission')
    expect(args.sellerId).toBe('seller-1')
    expect(args.invoiceNumber).toBe('F-001')
    expect(args.sourceOrderId).toBe('order-1')
    expect(args.createdByAdminId).toBe('admin-1')
  })

  it('passes penalty type with sourcePenaltyId for penalty invoices', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/seller-invoices/route')
    const res = await route.POST(
      buildRequest({
        ...validBody,
        type: 'penalty',
        sourceOrderId: undefined,
        sourcePenaltyId: 'pen-1',
        invoiceNumber: 'F-002',
      }),
    )
    expect(res.status).toBe(200)

    const args = invoiceCreateMock.mock.calls[0]?.[0]
    expect(args.type).toBe('penalty')
    expect(args.sourcePenaltyId).toBe('pen-1')
  })
})

// Note: Route-level Zod validation and DomainError mapping are exercised by the
// existing route's handleError + Zod schema. Reproducing them here would require
// a real DomainError instance that survives vitest module duplication, which is
// fragile. Service-level validation (waived penalty rejection, unique invoice
// number) is owned by `seller-invoice.service.ts` and tested via the service
// directly; the route just delegates.
