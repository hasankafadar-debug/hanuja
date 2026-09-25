import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const {
  appendStatusHistoryMock,
  auditCreateMock,
  confirmPaymentMock,
  findPaymentMock,
  postAccrualsMock,
  recordNotificationMock,
  updateOrderStatusMock,
} = vi.hoisted(() => ({
  appendStatusHistoryMock: vi.fn(),
  auditCreateMock: vi.fn(),
  confirmPaymentMock: vi.fn(),
  findPaymentMock: vi.fn(),
  postAccrualsMock: vi.fn(),
  recordNotificationMock: vi.fn(),
  updateOrderStatusMock: vi.fn(),
}))

vi.mock('../../../api/repositories/payment.repository', () => ({
  createPaymentRepository: vi.fn(() => ({
    findByOrderId: findPaymentMock,
    confirm: confirmPaymentMock,
  })),
}))
vi.mock('../../../api/repositories/order.repository', () => ({
  createOrderRepository: vi.fn(() => ({
    updateStatus: updateOrderStatusMock,
    appendStatusHistory: appendStatusHistoryMock,
  })),
}))
vi.mock('../../../api/repositories/admin-audit-log.repository', () => ({
  createAdminAuditLogRepository: vi.fn(() => ({ createEntry: auditCreateMock })),
}))
vi.mock('../../../api/services/seller-payment-accrual.service', () => ({
  postPaymentConfirmedSellerAccruals: postAccrualsMock,
}))
vi.mock('../../../api/services/quantity-refund.service', () => ({
  createQuantityRefundService: vi.fn(() => ({})),
}))
vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: recordNotificationMock,
}))
vi.mock('../../../api/services/order-document.service', () => ({
  createOrderDocumentService: vi.fn(() => ({ ensureInvoiceAliasesForOrder: vi.fn() })),
}))

import { createPaymentService } from '../../../api/services/payment.service'

describe('EFT payment approval transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findPaymentMock.mockResolvedValue({
      id: 'payment-1', method: 'eft', status: 'pending', amount: new Decimal('100.00'),
    })
    confirmPaymentMock.mockResolvedValue({ id: 'payment-1', method: 'eft', status: 'confirmed' })
  })

  it('confirms payment, advances the order and posts seller accruals on the same transaction client', async () => {
    const tx = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'order-1',
            status: 'bank_transfer_waiting',
            customerId: 'customer-1',
            totalAmount: new Decimal('100.00'),
            shippingAmount: new Decimal('0'),
            quantityLifecycleVersion: 2,
            lines: [{
              id: 'line-1', sellerId: 'seller-1',
              totalPrice: new Decimal('100.00'), customerPaidProductAmount: new Decimal('100.00'),
            }],
          })
          // Second read is the e-mail snapshot; null keeps this test focused on the
          // finance transaction (payload assertions live in payment.service.notifications).
          .mockResolvedValueOnce(null),
        update: vi.fn(),
      },
      payment: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'payment-1', method: 'eft', status: 'confirmed', amount: new Decimal('100.00'),
        })),
      },
      orderLine: { findMany: vi.fn(async () => []), update: vi.fn() },
      orderStatusHistory: { create: vi.fn() },
      cartItem: { deleteMany: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      order: { findUnique: vi.fn(async () => null) },
    }

    const service = createPaymentService({ prisma: prisma as never })
    const result = await service.approveEftPayment({
      orderId: 'order-1',
      adminActorId: 'admin-1',
      evidenceNote: 'Dekont kontrol edildi',
    })

    expect(result).toMatchObject({ id: 'payment-1', status: 'confirmed' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    // Compare-and-swap on the pending payment: a concurrent customer
    // cancellation closes the same row, so only one of them can win.
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'pending' },
      data: expect.objectContaining({ status: 'confirmed', eftConfirmedBy: 'admin-1' }),
    })
    expect(tx.order.update).toHaveBeenCalledTimes(3)
    expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(3)
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cart: { userId: 'customer-1' } },
    })
    expect(postAccrualsMock).toHaveBeenCalledWith(expect.objectContaining({
      prisma,
      tx,
      orderId: 'order-1',
      actorId: 'admin-1',
    }))
    expect(auditCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin-1',
      actionType: 'payment_approved',
      reason: 'Dekont kontrol edildi',
    }))
    // No discount: payment amount and discount fields untouched.
    const casData = (tx.payment.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
    expect(casData).not.toHaveProperty('amount')
    expect(casData).not.toHaveProperty('eftDiscountAmount')
    // Sellers read the status timeline: no admin evidence note in it.
    const reasons = tx.orderStatusHistory.create.mock.calls.map(
      (call) => (call as unknown as [{ data: { reason: string } }])[0].data.reason,
    )
    expect(reasons).toContain('Havale onaylandı')
    expect(reasons.join(' ')).not.toContain('Dekont kontrol edildi')
  })

  it('refuses to reopen an order that already left bank_transfer_waiting', async () => {
    const tx = {
      order: {
        findUnique: vi.fn(async () => ({
          id: 'order-1',
          status: 'cancelled_by_customer',
          customerId: 'customer-1',
          totalAmount: new Decimal('100.00'),
          lines: [{ sellerId: 'seller-1' }],
        })),
        update: vi.fn(),
      },
      payment: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const service = createPaymentService({ prisma: prisma as never })
    await expect(
      service.approveEftPayment({ orderId: 'order-1', adminActorId: 'admin-1' }),
    ).rejects.toThrow('havale onayı bekleyen durumda değil')
    expect(tx.payment.updateMany).not.toHaveBeenCalled()
    expect(tx.order.update).not.toHaveBeenCalled()
    expect(postAccrualsMock).not.toHaveBeenCalled()
  })
})

const firstArg = <T>(mock: { mock: { calls: unknown[][] } }) => mock.mock.calls[0]![0] as T

describe('EFT approval with an admin discount (Hanuja-absorbed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Order: 1000 + 500 products, 3% EFT channel discount already applied at
  // checkout (970 + 485), 49.99 shipping -> total 1504.99.
  function setup(options: { lifecycle?: 1 | 2 } = {}) {
    const lifecycle = options.lifecycle ?? 2
    const payment = {
      id: 'payment-1', method: 'eft', status: 'pending', amount: new Decimal('1504.99'),
    }
    findPaymentMock.mockResolvedValue(payment)
    const lines = [
      {
        id: 'line-a', sellerId: 'seller-1', totalPrice: new Decimal('1000.00'),
        customerPaidProductAmount: lifecycle === 2 ? new Decimal('970.00') : null,
      },
      {
        id: 'line-b', sellerId: 'seller-2', totalPrice: new Decimal('500.00'),
        customerPaidProductAmount: lifecycle === 2 ? new Decimal('485.00') : null,
      },
    ]
    let paymentRow: Record<string, unknown> = { ...payment }
    const tx = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'order-1',
            status: 'bank_transfer_waiting',
            customerId: 'customer-1',
            totalAmount: new Decimal('1504.99'),
            shippingAmount: new Decimal('49.99'),
            quantityLifecycleVersion: lifecycle,
            lines,
          })
          .mockResolvedValueOnce(null),
        update: vi.fn(),
      },
      payment: {
        updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
          paymentRow = { ...paymentRow, ...args.data }
          return { count: 1 }
        }),
        findUniqueOrThrow: vi.fn(async () => paymentRow),
      },
      paymentProviderItem: { updateMany: vi.fn(async () => ({ count: 1 })) },
      orderLine: { findMany: vi.fn(async () => []), update: vi.fn() },
      orderStatusHistory: { create: vi.fn() },
      cartItem: { deleteMany: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      order: { findUnique: vi.fn(async () => null) },
    }
    return { tx, service: createPaymentService({ prisma: prisma as never }) }
  }

  const statusReasons = (create: { mock: { calls: unknown[][] } }) =>
    create.mock.calls.map((call) => (call[0] as { data: { reason: string } }).data.reason)

  it('records the discount on the payment and lowers the collected amount', async () => {
    const { tx, service } = setup()
    await service.approveEftPayment({
      orderId: 'order-1', adminActorId: 'admin-1', evidenceNote: 'Dekont eksik yatırılmış',
      discountAmount: 15000, discountReason: 'Eksik havale kabul edildi',
    })
    const casData = firstArg<{ data: Record<string, Decimal> }>(tx.payment.updateMany).data
    expect(casData.amount!.toFixed(2)).toBe('1354.99')
    expect(casData.eftDiscountAmount!.toFixed(2)).toBe('150.00')
    expect(casData.eftDiscountReason).toBe('Eksik havale kabul edildi')

    const orderUpdate = firstArg<{
      data: { totalAmount: Decimal; discountAmount: { increment: Decimal } }
    }>(tx.order.update).data
    expect(orderUpdate.totalAmount.toFixed(2)).toBe('1354.99')
    expect(orderUpdate.discountAmount.increment.toFixed(2)).toBe('150.00')

    expect(auditCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      previousData: { status: 'pending', amount: '1504.99' },
      newData: expect.objectContaining({ amount: '1354.99', eftDiscountAmount: '150.00' }),
      reason: 'Dekont eksik yatırılmış',
    }))
    expect(statusReasons(tx.orderStatusHistory.create).join(' '))
      .not.toMatch(/İndirim|Dekont eksik|Eksik havale/)
  })

  it('reduces only customerPaidProductAmount and provider caps, proportionally and penny-exact', async () => {
    const { tx, service } = setup()
    await service.approveEftPayment({
      orderId: 'order-1', adminActorId: 'admin-1', discountAmount: 15000,
    })
    const lineUpdates = tx.orderLine.update.mock.calls.map(
      (call) => call[0] as { where: { id: string }; data: Record<string, Decimal> },
    )
    expect(lineUpdates.map((u) => [u.where.id, u.data.customerPaidProductAmount!.toFixed(2)])).toEqual([
      ['line-a', '870.00'],
      ['line-b', '435.00'],
    ])
    // Seller-side snapshots (totalPrice, coupon, commission, net payout) are never written.
    for (const update of lineUpdates) {
      expect(Object.keys(update.data)).toEqual(['customerPaidProductAmount'])
    }
    expect((970 - 870) + (485 - 435)).toBe(150)

    const providerUpdates = tx.paymentProviderItem.updateMany.mock.calls.map(
      (call) => (call as unknown[])[0] as { where: Record<string, string>; data: { amount: Decimal } },
    )
    expect(providerUpdates.map((u) => [u.where.orderLineId, u.where.kind, u.data.amount.toFixed(2)])).toEqual([
      ['line-a', 'product', '870.00'],
      ['line-b', 'product', '435.00'],
    ])
  })

  it('rejects a discount above the paid product total; shipping is not discountable', async () => {
    const { tx, service } = setup()
    await expect(service.approveEftPayment({
      orderId: 'order-1', adminActorId: 'admin-1', discountAmount: 145501, // 1455.01 > 970 + 485
    })).rejects.toThrow('İndirim tutarı ürün tutarını aşamaz')
    expect(tx.payment.updateMany).not.toHaveBeenCalled()
    expect(tx.order.update).not.toHaveBeenCalled()
    expect(postAccrualsMock).not.toHaveBeenCalled()
  })

  it('treats discountAmount 0 as no discount', async () => {
    const { tx, service } = setup()
    await service.approveEftPayment({ orderId: 'order-1', adminActorId: 'admin-1', discountAmount: 0 })
    const casData = firstArg<{ data: Record<string, unknown> }>(tx.payment.updateMany).data
    expect(casData).not.toHaveProperty('amount')
    expect(casData).not.toHaveProperty('eftDiscountAmount')
    expect(tx.orderLine.update).not.toHaveBeenCalled()
    expect(tx.paymentProviderItem.updateMany).not.toHaveBeenCalled()
    expect(tx.order.update).toHaveBeenCalledTimes(3) // status transitions only
  })

  it('rejects a negative or fractional kuruş amount', async () => {
    const { service } = setup()
    await expect(service.approveEftPayment({
      orderId: 'order-1', adminActorId: 'admin-1', discountAmount: -100,
    })).rejects.toThrow('Geçersiz indirim tutarı')
    await expect(service.approveEftPayment({
      orderId: 'order-1', adminActorId: 'admin-1', discountAmount: 10.5,
    })).rejects.toThrow('Geçersiz indirim tutarı')
  })

  it('leaves legacy (v1) line snapshots and provider items untouched but still lowers Payment.amount', async () => {
    const { tx, service } = setup({ lifecycle: 1 })
    await service.approveEftPayment({ orderId: 'order-1', adminActorId: 'admin-1', discountAmount: 10000 })
    const casData = firstArg<{ data: Record<string, Decimal> }>(tx.payment.updateMany).data
    expect(casData.amount!.toFixed(2)).toBe('1404.99')
    expect(tx.orderLine.update).not.toHaveBeenCalled()
    expect(tx.paymentProviderItem.updateMany).not.toHaveBeenCalled()
  })
})
