import { describe, expect, it } from 'vitest'
import { buildOrderExportHref } from '../../apps/admin-panel/src/lib/admin-order-export'
import {
  pendingSellerNames, formatApprovalWait, formatPaymentConfirmedAt,
} from '../../apps/admin-panel/src/lib/seller-approval-presentation'

describe('admin overdue seller approval presentation', () => {
  it('shows only pending sellers, once per seller, with identity fallback', () => {
    const lines = [
      { seller: { id: 'accepted', displayName: 'Accepted Store' } },
      { seller: { id: 'pending', displayName: 'Pending Store' } },
      { seller: { id: 'pending', displayName: 'Pending Store' } },
      { seller: { id: 'company', profile: { companyName: 'Company' } } },
    ]
    expect(pendingSellerNames(lines, ['pending', 'pending', 'company', 'unknown']))
      .toBe('Pending Store, Company, unknown')
    expect(pendingSellerNames(lines, [])).toBe('-')
  })

  it('shows elapsed full hours and minutes consistently at and beyond 24 hours', () => {
    const start = new Date('2026-09-20T10:00:00Z')
    expect(formatApprovalWait(start, new Date('2026-09-21T10:00:00Z'))).toBe('24 saat 0 dakika')
    expect(formatApprovalWait(start, new Date('2026-09-22T11:07:59Z'))).toBe('49 saat 7 dakika')
  })

  it('shows actual payment confirmation in Istanbul time and leaves missing timestamps blank', () => {
    expect(formatPaymentConfirmedAt(new Date('2026-09-20T22:15:00Z'))).toContain('21.09.2026')
    expect(formatPaymentConfirmedAt(new Date('2026-09-20T22:15:00Z'))).toContain('01:15')
    expect(formatPaymentConfirmedAt(null)).toBe('-')
    expect(formatPaymentConfirmedAt(undefined)).toBe('-')
  })

  it('exports the same overdue queue with all active filters', () => {
    const href = buildOrderExportHref({
      q: 'masa & lamba', status: ['seller_queue_ready', 'seller_reviewing'],
      invoice: 'missing', billing: 'present', seller: 'seller-1',
      from: '2026-09-01', to: '2026-09-21', sellerApprovalOverdue: true,
    })
    const url = new URL(href, 'https://admin.example.test')
    expect(url.pathname).toBe('/api/admin/orders')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'masa & lamba', status: 'seller_queue_ready,seller_reviewing',
      invoice: 'missing', billing: 'present', seller: 'seller-1',
      from: '2026-09-01', to: '2026-09-21', sellerApprovalOverdue: '1', format: 'csv',
    })
  })

  it('does not apply the overdue filter to ordinary exports', () => {
    expect(buildOrderExportHref({ q: '', status: [], invoice: '', seller: '', from: '', to: '' }))
      .toBe('/api/admin/orders?format=csv')
  })
})
