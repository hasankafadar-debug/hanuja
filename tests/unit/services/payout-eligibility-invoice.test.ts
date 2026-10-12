/**
 * Payout eligibility in the seller-Hanuja model: the term runs from the approved seller
 * invoice date (first Friday on/after date + payoutHoldDays, Europe/Istanbul) and delivery
 * confirmation plus closed returns/disputes remain preconditions.
 * CLAUDE.md §2.2, docs/01-business/payout-policy.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import { payoutDayAfterEligibility, readInvoicePayoutDueDate, readPayoutEligibility } from '../../../api/services/payout-eligibility'

// Invoice dated Monday 7 Sep 2026 → +30 days = Wednesday 7 Oct → first Friday 9 Oct 2026.
const INVOICE_DATE = new Date('2026-09-06T21:00:00Z')
const DUE_DATE = new Date('2026-10-08T21:00:00Z')

function payout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1', orderId: 'order-1', sellerId: 'seller-1', status: 'payout_hold_active',
    netAmount: new Decimal(760), currency: 'TRY', holdUntil: DUE_DATE, nextPaymentAt: DUE_DATE, nextPaymentAt: DUE_DATE,
    manualBlockedReason: null, manualBlockedAt: null, automaticBlockReason: null, blockedReason: null,
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    ...overrides,
  } as never
}

function tx(overrides: {
  invoice?: Record<string, unknown> | null
  deliveryConfirmedAt?: Date | null
  openReturns?: number
  holdDays?: number | null
} = {}) {
  return {
    order: { findUnique: vi.fn().mockResolvedValue({
      deliveryConfirmedAt: overrides.deliveryConfirmedAt === undefined ? new Date('2026-09-10T12:00:00Z') : overrides.deliveryConfirmedAt,
    }) },
    seller: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) },
    sellerBankDetail: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'bank-1', iban: 'TR000000000000000000000001', accountHolder: 'Atelier Noa',
        bankName: 'Test Bank', updatedAt: new Date('2026-08-01T00:00:00Z'),
      }),
      count: vi.fn().mockResolvedValue(0),
    },
    returnRequest: { count: vi.fn().mockResolvedValue(overrides.openReturns ?? 0) },
    dispute: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    refundTransaction: { count: vi.fn().mockResolvedValue(0) },
    orderSellerInvoice: { findUnique: vi.fn().mockResolvedValue(
      overrides.invoice === null ? null : { reviewStatus: 'approved', invoiceDate: INVOICE_DATE, ...overrides.invoice },
    ) },
    platformSettings: { findUnique: vi.fn().mockResolvedValue(
      overrides.holdDays === null ? null : { payoutHoldDays: overrides.holdDays ?? 30 },
    ) },
  } as never
}

describe('payout eligibility with the seller invoice term', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is ready on the due Friday once the invoice is approved and delivery is confirmed', async () => {
    vi.setSystemTime(new Date('2026-10-09T06:00:00Z'))
    const result = await readPayoutEligibility(tx(), payout())
    expect(result.dueDate).toEqual(DUE_DATE)
    expect(result.reason).toBeNull()
    expect(result.ready).toBe(true)
  })

  it('waits until the due day starts in Türkiye', async () => {
    // 8 Oct 23:30 Istanbul time.
    vi.setSystemTime(new Date('2026-10-08T20:30:00Z'))
    const result = await readPayoutEligibility(tx(), payout())
    expect(result.ready).toBe(false)
    expect(result.automaticReason).toBe('Fatura vadesi dolmadı (ödeme günü: 09.10.2026)')
  })

  it.each(['pending', 'rejected'])('blocks while the seller invoice is %s, however long ago delivery was', async (reviewStatus) => {
    vi.setSystemTime(new Date('2026-12-01T09:00:00Z'))
    const result = await readPayoutEligibility(tx({ invoice: { reviewStatus, invoiceDate: null } }), payout())
    expect(result.ready).toBe(false)
    expect(result.dueDate).toBeNull()
    expect(result.automaticReason).toBe("Tasarımcının Hanuja'ya faturası onaylanmadı")
  })

  it('blocks when no seller invoice exists', async () => {
    vi.setSystemTime(new Date('2026-12-01T09:00:00Z'))
    const result = await readPayoutEligibility(tx({ invoice: null }), payout({ holdUntil: null }))
    expect(result.ready).toBe(false)
    expect(result.automaticReason).toContain("Tasarımcının Hanuja'ya faturası onaylanmadı")
  })

  it('still requires delivery confirmation after the invoice term', async () => {
    vi.setSystemTime(new Date('2026-10-16T09:00:00Z'))
    const result = await readPayoutEligibility(tx({ deliveryConfirmedAt: null }), payout())
    expect(result.ready).toBe(false)
    expect(result.automaticReason).toContain('Teslim onayı bekleniyor')
  })

  it('does not pay a payout whose due date has not been written yet', async () => {
    vi.setSystemTime(new Date('2026-10-16T09:00:00Z'))
    const result = await readPayoutEligibility(tx(), payout({ holdUntil: null }))
    expect(result.ready).toBe(false)
    expect(result.holdExpired).toBe(false)
  })

  it('keeps open returns blocking after the due date', async () => {
    vi.setSystemTime(new Date('2026-10-16T09:00:00Z'))
    const result = await readPayoutEligibility(tx({ openReturns: 1 }), payout())
    expect(result.ready).toBe(false)
    expect(result.automaticReason).toBe('Açık iade talebi var')
  })
})

describe('persistent payment day', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('waits for the stored Friday after a Monday unblock', async () => {
    vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))
    const nextPaymentAt = payoutDayAfterEligibility(DUE_DATE, new Date())
    expect(nextPaymentAt).toEqual(new Date('2026-10-15T21:00:00Z'))
    const result = await readPayoutEligibility(tx(), payout({ nextPaymentAt }))
    expect(result.ready).toBe(false)
    expect(result.automaticReason).toBe('Ödeme günü bekleniyor (16.10.2026)')
  })
  it('allows the same Friday when the blocker clears on Friday', async () => {
    vi.setSystemTime(new Date('2026-10-09T09:00:00Z'))
    const nextPaymentAt = payoutDayAfterEligibility(DUE_DATE, new Date())
    expect(nextPaymentAt).toEqual(DUE_DATE)
    expect((await readPayoutEligibility(tx(), payout({ nextPaymentAt }))).ready).toBe(true)
  })
  it('moves a public-holiday Friday to the next business day', () => {
    expect(payoutDayAfterEligibility(new Date('2026-04-01T21:00:00Z'), new Date('2026-05-01T09:00:00Z')))
      .toEqual(new Date('2026-05-03T21:00:00Z'))
  })
  it('cannot pay an invalidated schedule after the invoice term', async () => {
    vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))
    expect((await readPayoutEligibility(tx(), payout({ nextPaymentAt: null }))).ready).toBe(false)
  })
  it('never moves a stored Friday forward on repeated reads', async () => {
    const nextPaymentAt = new Date('2026-10-15T21:00:00Z')
    const row = payout({ nextPaymentAt })
    vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))
    expect((await readPayoutEligibility(tx(), row)).nextPaymentAt).toEqual(nextPaymentAt)
    vi.setSystemTime(new Date('2026-10-17T09:00:00Z'))
    const result = await readPayoutEligibility(tx(), row)
    expect(result.nextPaymentAt).toEqual(nextPaymentAt)
    expect(result.ready).toBe(true)
  })
})

describe('readInvoicePayoutDueDate', () => {
  it('uses the admin-configured term', async () => {
    // 7 Sep + 15 days = Tuesday 22 Sep → Friday 25 Sep 2026.
    await expect(readInvoicePayoutDueDate(tx({ holdDays: 15 }), 'order-1', 'seller-1'))
      .resolves.toEqual(new Date('2026-09-24T21:00:00Z'))
  })

  it('falls back to 30 days when settings are missing', async () => {
    await expect(readInvoicePayoutDueDate(tx({ holdDays: null }), 'order-1', 'seller-1')).resolves.toEqual(DUE_DATE)
  })

  it('has no due date for an approved record without a date', async () => {
    await expect(readInvoicePayoutDueDate(tx({ invoice: { invoiceDate: null } }), 'order-1', 'seller-1')).resolves.toBeNull()
  })
})
