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
    findPaymentMock.mockResolvedValue({ id: 'payment-1', method: 'eft', status: 'pending' })
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
            lines: [{ sellerId: 'seller-1' }],
          })
          // Second read is the e-mail snapshot; null keeps this test focused on the
          // finance transaction (payload assertions live in payment.service.notifications).
          .mockResolvedValueOnce(null),
        update: vi.fn(),
      },
      payment: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ id: 'payment-1', method: 'eft', status: 'confirmed' })),
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
    }))
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
