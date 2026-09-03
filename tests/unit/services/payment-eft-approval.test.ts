import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const {
  appendStatusHistoryMock,
  auditCreateMock,
  confirmPaymentMock,
  findPaymentMock,
  postAccrualsMock,
  updateOrderStatusMock,
} = vi.hoisted(() => ({
  appendStatusHistoryMock: vi.fn(),
  auditCreateMock: vi.fn(),
  confirmPaymentMock: vi.fn(),
  findPaymentMock: vi.fn(),
  postAccrualsMock: vi.fn(),
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
vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
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
        findUnique: vi.fn(async () => ({
          id: 'order-1',
          customerId: 'customer-1',
          totalAmount: new Decimal('100.00'),
          lines: [{ sellerId: 'seller-1' }],
        })),
        update: vi.fn(),
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
    expect(confirmPaymentMock).toHaveBeenCalledWith(
      'payment-1',
      { confirmedBy: 'admin-1' },
      tx,
    )
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
})
