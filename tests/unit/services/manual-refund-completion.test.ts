import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

// Use the real decimal implementation for money assertions, not the numeric test shim.
vi.mock('@prisma/client/runtime/client', () =>
  createRequire(import.meta.url)('@prisma/client/runtime/client'),
)
const { notify } = vi.hoisted(() => ({ notify: vi.fn(async () => undefined) }))
vi.mock('../../../api/jobs/refund-processing.job', () => ({ enqueueRefundProcessing: vi.fn() }))
vi.mock('../../../api/services/refund-notification.service', () => ({
  enqueueRefundCompletedNotifications: notify,
}))
import { Decimal } from '@prisma/client/runtime/client'
import { createQuantityRefundService } from '../../../api/services/quantity-refund.service'
import { getManualEftRefundCompletion } from '../../../api/domain/manual-eft-refund'

function fixture() {
  const payment = {
    id: 'p1',
    orderId: 'o1',
    method: 'eft',
    provider: 'manual_eft',
    status: 'confirmed',
    currency: 'TRY',
    amount: new Decimal('77121.00'),
    refundedAmount: new Decimal(0),
  }
  const provider = {
    id: 'pp1',
    paymentId: 'p1',
    amount: new Decimal('77121.00'),
    refundedAmount: new Decimal(0),
  }
  const items = [
    {
      id: 'i1',
      status: 'pending',
      amount: new Decimal('38560.50'),
      paymentProviderItem: provider,
      providerReference: null as string | null,
    },
  ]
  const refund = {
    id: 'r1',
    orderId: 'o1',
    paymentId: 'p1',
    status: 'manual_required',
    sourceType: 'cancellation',
    sourceId: 'c1',
    customerAmount: new Decimal('38560.50'),
    providerReference: null as string | null,
    completedAt: null as Date | null,
    updatedAt: new Date('2026-09-03T00:00:00Z'),
  }
  let linkedPayment: typeof payment | null = payment
  const audit: unknown[] = []
  const read = () => ({
    ...refund,
    payment: linkedPayment && { ...linkedPayment },
    items: items.map((item) => ({ ...item, paymentProviderItem: { ...provider } })),
  })
  const prisma = {
    refundTransaction: {
      findUnique: vi.fn(async () => read()),
      findUniqueOrThrow: vi.fn(async () => ({ ...refund })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.status !== refund.status || where.updatedAt !== refund.updatedAt)
          return { count: 0 }
        Object.assign(refund, data)
        return { count: 1 }
      }),
    },
    refundTransactionItem: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const item = items.find((entry) => entry.id === where.id && entry.status === where.status)
        if (!item) return { count: 0 }
        Object.assign(item, data)
        return { count: 1 }
      }),
    },
    paymentProviderItem: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (provider.refundedAmount.gt(where.refundedAmount.lte)) return { count: 0 }
        provider.refundedAmount = provider.refundedAmount.add(data.refundedAmount.increment)
        return { count: 1 }
      }),
    },
    payment: {
      findUniqueOrThrow: vi.fn(async () => ({ ...payment })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (payment.status !== where.status || payment.refundedAmount.gt(where.refundedAmount.lte))
          return { count: 0 }
        payment.refundedAmount = payment.refundedAmount.add(data.refundedAmount.increment)
        return { count: 1 }
      }),
      update: vi.fn(async ({ data }: any) => Object.assign(payment, data)),
    },
    orderCancellation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    returnRequest: { update: vi.fn(), updateMany: vi.fn() },
    order: {
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(async () => ({
        quantityLifecycleVersion: 2,
        status: 'partially_delivered',
      })),
    },
    orderStatusHistory: { create: vi.fn() },
    adminAuditLog: {
      create: vi.fn(async ({ data }: any) => {
        audit.push(data)
        return data
      }),
    },
    sellerLedgerEntry: { create: vi.fn() },
    payout: { update: vi.fn() },
    $transaction: vi.fn(),
  }
  // Transactional fake restores writes on failure. Real DB locking is not claimed by these tests.
  prisma.$transaction.mockImplementation(async (callback) => {
    const previous = {
      refund: { ...refund },
      payment: { ...payment },
      provider: { ...provider },
      items: items.map((item) => ({ ...item })),
      audit: [...audit],
    }
    try {
      return await callback(prisma)
    } catch (error) {
      Object.assign(refund, previous.refund)
      Object.assign(payment, previous.payment)
      Object.assign(provider, previous.provider)
      items.splice(0, items.length, ...previous.items)
      audit.splice(0, audit.length, ...previous.audit)
      throw error
    }
  })
  const complete = (overrides = {}) =>
    createQuantityRefundService({ prisma: prisma as never }).complete({
      refundTransactionId: 'r1',
      orderId: 'o1',
      actorId: 'admin-1',
      providerReference: 'BANK-123',
      expectedOutstandingAmount: '38560.50',
      ipAddress: '127.0.0.1',
      ...overrides,
    })
  return {
    prisma,
    refund,
    payment,
    provider,
    items,
    audit,
    read,
    complete,
    unlinkPayment: () => {
      linkedPayment = null
    },
  }
}

describe('manual EFT refund completion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('completes only this partial cancellation; records an audit and removes manual-queue eligibility', async () => {
    const f = fixture()
    expect(f.refund.status).toBe('manual_required')
    const result = await f.complete()
    expect(result.status).toBe('completed')
    expect(f.payment.refundedAmount.toFixed(2)).toBe('38560.50')
    expect(f.payment.status).toBe('confirmed')
    expect(f.items[0]!.status).toBe('completed')
    expect(f.provider.refundedAmount.toFixed(2)).toBe('38560.50')
    expect(f.prisma.orderCancellation.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'completed' },
    })
    expect(f.audit).toEqual([
      expect.objectContaining({
        actorId: 'admin-1',
        targetId: 'r1',
        ipAddress: '127.0.0.1',
        previousData: { status: 'manual_required', outstandingAmount: '38560.50' },
        newData: expect.objectContaining({
          amount: '38560.50',
          providerReference: 'BANK-123',
          currency: 'TRY',
        }),
      }),
    ])
    expect(f.prisma.sellerLedgerEntry.create).not.toHaveBeenCalled()
    expect(f.prisma.payout.update).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('makes retries idempotent without replacing reference, audit or money', async () => {
    const f = fixture()
    await f.complete()
    await f.complete()
    expect(f.payment.refundedAmount.toFixed(2)).toBe('38560.50')
    expect(f.audit).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(2)
    await expect(f.complete({ providerReference: 'DIFFERENT' })).rejects.toThrow(
      'zaten tamamlanmış',
    )
    expect(f.refund.providerReference).toBe('BANK-123')
  })
  it('accounts once when two admins submit the same reference', async () => {
    const f = fixture()
    await Promise.all([f.complete(), f.complete()])
    expect(f.prisma.payment.updateMany).toHaveBeenCalledTimes(1)
    expect(f.audit).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(2)
  })
  it.each(['pending', 'processing', 'partially_completed', 'failed'])(
    'rejects parent status %s before writing',
    async (status) => {
      const f = fixture()
      f.refund.status = status
      await expect(f.complete()).rejects.toThrow('manuel ödeme onayı beklemiyor')
      expect(f.prisma.refundTransaction.updateMany).not.toHaveBeenCalled()
    },
  )
  it.each(['pending', 'failed', 'manual_required'])(
    'does not manually complete a card payment even with item state %s',
    async (status) => {
      const f = fixture()
      f.payment.method = 'card'
      f.payment.provider = 'iyzico'
      f.items[0]!.status = status
      await expect(f.complete()).rejects.toThrow('yalnızca EFT/havale')
      expect(f.prisma.payment.updateMany).not.toHaveBeenCalled()
    },
  )
  it('rejects missing payment, missing items, wrong order and stale screen amounts', async () => {
    const missing = fixture()
    missing.unlinkPayment()
    await expect(missing.complete()).rejects.toThrow('Ödeme kaydı bulunamadı')
    const empty = fixture()
    empty.items.length = 0
    expect(getManualEftRefundCompletion(empty.read()).outstandingAmount).toBeNull()
    await expect(empty.complete()).rejects.toThrow('kalemleri ve toplam tutar')
    await expect(fixture().complete({ orderId: 'other' })).rejects.toThrow('bu siparişe ait değil')
    await expect(fixture().complete({ expectedOutstandingAmount: '77121.00' })).rejects.toThrow(
      'tutarı değişmiş',
    )
  })
  it.each(['pending', 'refunded', 'cancelled', 'chargebacked'])(
    'rejects non-confirmed payment %s',
    async (status) => {
      const f = fixture()
      f.payment.status = status
      await expect(f.complete()).rejects.toThrow('onaylanmış')
    },
  )
  it('rejects wrong payment order, bad item totals, nonpositive amounts and processing items', async () => {
    const wrong = fixture()
    wrong.payment.orderId = 'other'
    await expect(wrong.complete()).rejects.toThrow('onaylanmış')
    const totals = fixture()
    totals.refund.customerAmount = new Decimal('80000')
    await expect(totals.complete()).rejects.toThrow('kalemleri ve toplam tutar')
    const zero = fixture()
    zero.items[0]!.amount = new Decimal(0)
    await expect(zero.complete()).rejects.toThrow('kalemleri ve toplam tutar')
    const processing = fixture()
    processing.items[0]!.status = 'processing'
    await expect(processing.complete()).rejects.toThrow('işlem durumu değişmiş')
  })
  it('adds only unfinished item amounts and marks the fully refunded payment', async () => {
    const f = fixture()
    f.refund.customerAmount = new Decimal('77121.00')
    f.payment.refundedAmount = new Decimal('38560.50')
    f.provider.refundedAmount = new Decimal('38560.50')
    f.items.push({
      ...f.items[0]!,
      id: 'already-paid',
      status: 'completed',
      providerReference: 'OLD-REF',
    })
    await f.complete()
    expect(f.payment.refundedAmount.toFixed(2)).toBe('77121.00')
    expect(f.payment.status).toBe('refunded')
    expect(f.items[1]!.providerReference).toBe('OLD-REF')
    expect(f.prisma.refundTransactionItem.updateMany).toHaveBeenCalledTimes(1)
  })
  it.each(['audit', 'providerCap', 'paymentCap', 'itemClaim'])(
    'rolls back all financial writes if %s fails',
    async (failure) => {
      const f = fixture()
      if (failure === 'audit')
        f.prisma.adminAuditLog.create.mockRejectedValueOnce(new Error('audit unavailable'))
      if (failure === 'providerCap')
        f.prisma.paymentProviderItem.updateMany.mockResolvedValueOnce({ count: 0 })
      if (failure === 'paymentCap') f.prisma.payment.updateMany.mockResolvedValueOnce({ count: 0 })
      if (failure === 'itemClaim')
        f.prisma.refundTransactionItem.updateMany.mockResolvedValueOnce({ count: 0 })
      await expect(f.complete()).rejects.toThrow()
      expect(f.refund.status).toBe('manual_required')
      expect(f.payment.refundedAmount.toFixed(2)).toBe('0.00')
      expect(f.provider.refundedAmount.toFixed(2)).toBe('0.00')
      expect(f.items[0]!.status).toBe('pending')
      expect(f.audit).toHaveLength(0)
      expect(notify).not.toHaveBeenCalled()
    },
  )
  it('fails closed on a lost parent claim instead of returning non-completed success', async () => {
    const f = fixture()
    f.prisma.refundTransaction.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(f.complete()).rejects.toThrow('İade kaydı değişmiş')
    expect(f.prisma.payment.updateMany).not.toHaveBeenCalled()
  })
  it.each([1, 2])('preserves version %i return lifecycle semantics', async (version) => {
    const f = fixture()
    f.refund.sourceType = 'return_request'
    f.prisma.order.findUniqueOrThrow.mockResolvedValueOnce({
      quantityLifecycleVersion: version,
      status: 'return_received',
    })
    await f.complete()
    expect(f.prisma.returnRequest.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ status: 'refund_completed' }),
    })
    expect(f.prisma.order.update).toHaveBeenCalledTimes(version === 2 ? 0 : 1)
    expect(f.prisma.orderStatusHistory.create).toHaveBeenCalledTimes(version === 2 ? 0 : 1)
  })
  it('completes associated dispute return requests without resolving the dispute or releasing payout', async () => {
    const f = fixture()
    f.refund.sourceType = 'dispute'
    await f.complete()
    expect(f.prisma.returnRequest.updateMany).toHaveBeenCalledWith({
      where: { disputeId: 'c1' },
      data: expect.objectContaining({ status: 'refund_completed' }),
    })
    expect(f.prisma.payout.update).not.toHaveBeenCalled()
  })
  it('preserves legacy cancellation completion metadata', async () => {
    const f = fixture()
    f.refund.sourceId = 'legacy-order:o1'
    f.prisma.orderCancellation.updateMany.mockResolvedValueOnce({ count: 0 })
    await f.complete()
    expect(f.prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { refundCompletedAt: expect.any(Date) },
    })
  })
  it('uses decimal arithmetic for fractional kuruş boundaries', () => {
    const f = fixture()
    f.items[0]!.amount = new Decimal('0.10')
    f.items.push({ ...f.items[0]!, id: 'i2', amount: new Decimal('0.20') })
    f.refund.customerAmount = new Decimal('0.30')
    expect(getManualEftRefundCompletion(f.read())).toEqual({
      outstandingAmount: '0.30',
      blockedReason: null,
    })
  })
})
