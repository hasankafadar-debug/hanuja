import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'

const {
  getSessionMock,
  createPrismaForRouteMock,
  penaltyFindUniqueMock,
  penaltyUpdateMock,
  sellerInvoiceFindUniqueMock,
  sellerInvoiceUpdateMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  createPrismaForRouteMock: vi.fn(),
  penaltyFindUniqueMock: vi.fn(),
  penaltyUpdateMock: vi.fn(),
  sellerInvoiceFindUniqueMock: vi.fn(),
  sellerInvoiceUpdateMock: vi.fn(),
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

describe('admin finance edit routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => {})

    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    createPrismaForRouteMock.mockReturnValue({
      penalty: {
        findUnique: penaltyFindUniqueMock,
        update: penaltyUpdateMock,
      },
      sellerInvoice: {
        findUnique: sellerInvoiceFindUniqueMock,
        update: sellerInvoiceUpdateMock,
      },
    })
  })

  it('recomputes penalty rate when the amount is edited', async () => {
    penaltyFindUniqueMock.mockResolvedValue({
      id: 'pen-1',
      status: 'applied',
      reason: 'late_shipment_daily_accrual',
      baseAmount: new Decimal(500),
      rate: new Decimal('0.0200'),
      penaltyAmount: new Decimal(10),
    })
    penaltyUpdateMock.mockResolvedValue({
      id: 'pen-1',
      reason: 'late_shipment_daily_accrual',
      rate: new Decimal('0.0300'),
      penaltyAmount: new Decimal(15),
    })

    const route = await import('../../../apps/admin-panel/src/app/api/admin/penalties/[id]/route')
    const res = await route.PUT(
      new Request('http://localhost/api/admin/penalties/pen-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: '15.00' }),
      }) as never,
      { params: Promise.resolve({ id: 'pen-1' }) },
    )

    expect(res.status).toBe(200)
    const penaltyUpdateArgs = penaltyUpdateMock.mock.calls[0]?.[0]
    expect(penaltyUpdateArgs.where).toEqual({ id: 'pen-1' })
    expect(typeof penaltyUpdateArgs.data.penaltyAmount?.toString).toBe('function')
    expect(typeof penaltyUpdateArgs.data.rate?.toString).toBe('function')
    expect(penaltyUpdateArgs.data.penaltyAmount.toString()).toBe('15')
    expect(penaltyUpdateArgs.data.rate.toString()).toBe('0.03')
  })

  it('rejects edits for waived penalties', async () => {
    penaltyFindUniqueMock.mockResolvedValue({
      id: 'pen-2',
      status: 'waived',
      reason: 'other',
      baseAmount: new Decimal(500),
      rate: new Decimal('0.0100'),
      penaltyAmount: new Decimal(5),
    })

    const route = await import('../../../apps/admin-panel/src/app/api/admin/penalties/[id]/route')
    const res = await route.PUT(
      new Request('http://localhost/api/admin/penalties/pen-2', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: '20.00' }),
      }) as never,
      { params: Promise.resolve({ id: 'pen-2' }) },
    )

    expect(res.status).toBe(422)
    expect(penaltyUpdateMock).not.toHaveBeenCalled()
  })

  it('recomputes invoice net and vat when only gross is edited', async () => {
    sellerInvoiceFindUniqueMock.mockResolvedValue({
      id: 'inv-1',
      type: 'commission',
      payoutId: null,
      invoiceNumber: 'F-001',
      invoiceDate: new Date('2026-05-14T00:00:00.000Z'),
      invoiceCategory: 'commission',
      description: 'Commission invoice',
      amount: new Decimal(100),
      vatRate: new Decimal('0.20'),
      vatAmount: new Decimal(20),
      grossInvoiceAmount: new Decimal(120),
    })
    sellerInvoiceUpdateMock.mockResolvedValue({
      id: 'inv-1',
      invoiceDate: new Date('2026-05-14T00:00:00.000Z'),
      invoiceCategory: 'commission',
      description: 'Commission invoice',
      amount: new Decimal(150),
      vatAmount: new Decimal(30),
      grossInvoiceAmount: new Decimal(180),
    })

    const route = await import('../../../apps/admin-panel/src/app/api/admin/seller-invoices/[id]/route')
    const res = await route.PUT(
      new Request('http://localhost/api/admin/seller-invoices/inv-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grossInvoiceAmount: '180.00' }),
      }) as never,
      { params: Promise.resolve({ id: 'inv-1' }) },
    )

    expect(res.status).toBe(200)
    const sellerInvoiceUpdateArgs = sellerInvoiceUpdateMock.mock.calls[0]?.[0]
    expect(sellerInvoiceUpdateArgs.where).toEqual({ id: 'inv-1' })
    expect(typeof sellerInvoiceUpdateArgs.data.amount?.toString).toBe('function')
    expect(typeof sellerInvoiceUpdateArgs.data.vatAmount?.toString).toBe('function')
    expect(typeof sellerInvoiceUpdateArgs.data.grossInvoiceAmount?.toString).toBe('function')
    expect(sellerInvoiceUpdateArgs.data.amount.toString()).toBe('150')
    expect(sellerInvoiceUpdateArgs.data.vatAmount.toString()).toBe('30')
    expect(sellerInvoiceUpdateArgs.data.grossInvoiceAmount.toString()).toBe('180')
  })

  it('rejects edits for payout-linked invoices', async () => {
    sellerInvoiceFindUniqueMock.mockResolvedValue({
      id: 'inv-2',
      type: 'commission',
      payoutId: 'payout-1',
      invoiceNumber: 'F-002',
      invoiceDate: new Date('2026-05-14T00:00:00.000Z'),
      invoiceCategory: 'commission',
      description: 'Locked invoice',
      amount: new Decimal(100),
      vatRate: new Decimal('0.20'),
      vatAmount: new Decimal(20),
      grossInvoiceAmount: new Decimal(120),
    })

    const route = await import('../../../apps/admin-panel/src/app/api/admin/seller-invoices/[id]/route')
    const res = await route.PUT(
      new Request('http://localhost/api/admin/seller-invoices/inv-2', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: '150.00' }),
      }) as never,
      { params: Promise.resolve({ id: 'inv-2' }) },
    )

    expect(res.status).toBe(422)
    expect(sellerInvoiceUpdateMock).not.toHaveBeenCalled()
  })
})
