import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  prisma: vi.fn(),
  counts: vi.fn(),
  manual: vi.fn(),
  failed: vi.fn(),
  returns: vi.fn(),
  refundRows: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))
vi.mock('@/lib/admin-session', () => ({ getAdminSession: mocks.session }))
vi.mock(
  '@/lib/admin-refund-list-params',
  async () => import('../../apps/admin-panel/src/lib/admin-refund-list-params'),
)
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: mocks.prisma }))
vi.mock('@hanuja/api/services/admin-refund-query.service', () => ({
  createAdminRefundQueryService: () => ({
    getCounts: mocks.counts,
    listManualRequiredForAdmin: mocks.manual,
    listFailedCardForAdmin: mocks.failed,
  }),
}))
vi.mock('@hanuja/api/services/return.service', () => ({
  createReturnService: () => ({ listForAdmin: mocks.returns }),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@hanuja/ui', () => ({
  Button: () => null,
  StatusBadge: () => null,
  PageHeader: () => null,
}))
vi.mock('../../apps/admin-panel/src/app/(panel)/iadeler/_components/return-review-actions', () => ({
  ReturnReviewActions: () => null,
}))

import ReturnsAdminPage from '../../apps/admin-panel/src/app/(panel)/iadeler/page'
import { createRequire } from 'node:module'
const appRequire = createRequire(new URL('../../apps/admin-panel/package.json', import.meta.url))
const React = appRequire('react')

describe('admin refund queue server page', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('React', React)
    mocks.session.mockResolvedValue({ user: { role: 'admin' } })
    mocks.prisma.mockReturnValue({ refundTransaction: { findMany: mocks.refundRows } })
    mocks.counts.mockResolvedValue({ pendingManualRefunds: 0, failedCardRefunds: 0 })
    mocks.manual.mockResolvedValue({ rows: [], total: 0 })
    mocks.failed.mockResolvedValue({ rows: [], total: 0 })
    mocks.returns.mockResolvedValue([])
  })
  it('does not read any refund data before authentication succeeds', async () => {
    mocks.session.mockRejectedValueOnce(new Error('unauthorized'))
    await expect(
      ReturnsAdminPage({ searchParams: Promise.resolve({ tab: 'manual_refunds' }) }),
    ).rejects.toThrow('unauthorized')
    expect(mocks.prisma).not.toHaveBeenCalled()
    expect(mocks.counts).not.toHaveBeenCalled()
    expect(mocks.manual).not.toHaveBeenCalled()
  })
  it('keeps /iadeler and unknown tabs on the original return-request flow', async () => {
    await ReturnsAdminPage({ searchParams: Promise.resolve({ tab: 'invalid' }) })
    expect(mocks.returns).toHaveBeenCalledWith({ skip: 0, take: 50 })
    expect(mocks.manual).not.toHaveBeenCalled()
    expect(mocks.failed).not.toHaveBeenCalled()
  })
  it('passes normalized server-side filters and pagination to the manual queue only', async () => {
    mocks.manual.mockResolvedValueOnce({ rows: [], total: 75 })
    await ReturnsAdminPage({
      searchParams: Promise.resolve({
        tab: 'manual_refunds',
        page: '2',
        pageSize: '50',
        q: ' #26050074 ',
        method: 'eft',
        source: 'cancellation',
      }),
    })
    expect(mocks.manual).toHaveBeenCalledWith({
      skip: 50,
      take: 50,
      query: '#26050074',
      method: 'eft',
      sourceType: 'cancellation',
    })
    expect(mocks.failed).not.toHaveBeenCalled()
    expect(mocks.returns).not.toHaveBeenCalled()
  })
  it('uses the failed-card query, not the manual or product-return query', async () => {
    await ReturnsAdminPage({
      searchParams: Promise.resolve({
        tab: 'failed_card_refunds',
        method: 'eft',
        source: 'return_request',
      }),
    })
    expect(mocks.failed).toHaveBeenCalledWith({ skip: 0, take: 20, sourceType: 'return_request' })
    expect(mocks.manual).not.toHaveBeenCalled()
    expect(mocks.returns).not.toHaveBeenCalled()
  })
  it('redirects an emptied last page to a valid page while preserving filters', async () => {
    mocks.manual.mockResolvedValueOnce({ rows: [], total: 21 })
    await expect(
      ReturnsAdminPage({
        searchParams: Promise.resolve({ tab: 'manual_refunds', page: '3', q: 'Müşteri' }),
      }),
    ).rejects.toThrow('redirect:')
    const target = new URL(mocks.redirect.mock.calls[0]![0], 'https://admin.test')
    expect(target.searchParams.get('page')).toBe('2')
    expect(target.searchParams.get('q')).toBe('Müşteri')
    expect(target.searchParams.get('tab')).toBe('manual_refunds')
  })
  it('propagates query failures instead of showing a false empty queue', async () => {
    mocks.manual.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      ReturnsAdminPage({ searchParams: Promise.resolve({ tab: 'manual_refunds' }) }),
    ).rejects.toThrow('database unavailable')
  })
})
