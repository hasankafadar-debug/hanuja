import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const {
  recordNotificationMock,
  dispatchMock,
  executeReturnRefundInTransactionMock,
  reviewMock,
  setSellerReceivedMock,
  findByIdMock,
  updateStatusMock,
  appendStatusHistoryMock,
  auditCreateMock,
} = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
  dispatchMock: vi.fn(),
  executeReturnRefundInTransactionMock: vi.fn(),
  reviewMock: vi.fn(),
  setSellerReceivedMock: vi.fn(),
  findByIdMock: vi.fn(),
  updateStatusMock: vi.fn(),
  appendStatusHistoryMock: vi.fn(),
  auditCreateMock: vi.fn(),
}))

vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: recordNotificationMock,
}))
vi.mock('../../../api/services/quantity-refund.service', () => ({
  createQuantityRefundService: vi.fn(() => ({ queue: vi.fn() })),
  dispatchRefundProcessingAfterCommit: dispatchMock,
}))
vi.mock('../../../api/services/refund.service', () => ({
  createRefundService: vi.fn(() => ({
    executeReturnRefundInTransaction: executeReturnRefundInTransactionMock,
  })),
}))
vi.mock('../../../api/repositories/return-request.repository', () => ({
  sellerScopedReturnWhere: (id: string, sellerId: string) => ({
    id,
    OR: [{ sellerId }, { sellerId: null, order: { lines: { some: { sellerId } } } }],
  }),
  createReturnRequestRepository: vi.fn(() => ({
    review: reviewMock,
    setSellerReceived: setSellerReceivedMock,
    findById: findByIdMock,
  })),
}))
vi.mock('../../../api/repositories/order.repository', () => ({
  createOrderRepository: vi.fn(() => ({
    updateStatus: updateStatusMock,
    appendStatusHistory: appendStatusHistoryMock,
  })),
}))
vi.mock('../../../api/repositories/dispute.repository', () => ({
  createDisputeRepository: vi.fn(() => ({ create: vi.fn() })),
}))
vi.mock('../../../api/repositories/admin-audit-log.repository', () => ({
  createAdminAuditLogRepository: vi.fn(() => ({ createEntry: auditCreateMock })),
}))

import { createReturnService } from '../../../api/services/return.service'

const orderLine = {
  id: 'line-1',
  sellerId: 'seller-1',
  productId: 'product-1',
  productName: 'Gea Berjer',
  variantName: null,
  unitPrice: new Decimal('100.00'),
  totalPrice: new Decimal('200.00'),
  quantity: 2,
  cancelledQuantity: 0,
}

function returnRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    orderId: 'order-1',
    customerId: 'customer-1',
    sellerId: 'seller-1',
    reason: 'Hasarlı',
    status: 'in_transit',
    items: [],
    order: {
      id: 'order-1',
      publicNumber: 26050042,
      status: 'return_in_transit',
      lines: [orderLine],
      payments: [{ id: 'payment-1', method: 'card', providerPaymentId: 'prov-1' }],
    },
    ...overrides,
  }
}

function buildTx(rr: ReturnType<typeof returnRequest>) {
  const tx = {
    returnRequest: {
      findFirst: vi.fn().mockResolvedValue(rr),
      findUnique: vi.fn().mockResolvedValue(rr),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: 'customer@example.com', name: 'Ayşe' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    productImage: { findMany: vi.fn().mockResolvedValue([]) },
    seller: { findUnique: vi.fn().mockResolvedValue({ userId: 'seller-user-1', displayName: 'Atelier' }) },
    mediaAsset: { updateMany: vi.fn() },
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  }
  return { tx, prisma }
}

describe('legacy return service notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.hanuja.com.tr')
    findByIdMock.mockResolvedValue({ id: 'return-1' })
    reviewMock.mockImplementation(async (_id, data) => ({ ...returnRequest(), ...data }))
    setSellerReceivedMock.mockResolvedValue(returnRequest({ status: 'received' }))
  })

  it('tells the customer the first admin approval started no refund and uses a review-scoped event key', async () => {
    const rr = returnRequest({ status: 'requested', order: { ...returnRequest().order, status: 'return_requested' } })
    const { tx, prisma } = buildTx(rr)
    const service = createReturnService({ prisma: prisma as never })

    await service.reviewRequest({
      returnRequestId: 'return-1',
      adminActorId: 'admin-1',
      decision: 'approved',
      reviewNote: 'Kargo bilgisi iletilecek',
    })

    expect(recordNotificationMock).toHaveBeenCalledTimes(1)
    const [client, payload] = recordNotificationMock.mock.calls[0]!
    expect(client).toBe(tx)
    expect(payload).toMatchObject({
      eventKey: 'return:return-1:customer:review:approved',
      type: 'order_return_approved',
      emailTo: 'customer@example.com',
    })
    expect(payload.data).toMatchObject({ decision: 'approved', refundOutcome: 'awaiting_return' })
    expect(payload.data.refundAmount).toBeUndefined()
    expect(executeReturnRefundInTransactionMock).not.toHaveBeenCalled()
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('derives the receipt decision wording from the persisted refund record and dispatches only after commit', async () => {
    const outcomes: Array<[string, string, string]> = [
      ['pending', '200.00', 'processing'],
      ['processing', '200.00', 'processing'],
      ['manual_required', '200.00', 'manual_review'],
      ['completed', '0', 'no_refund_due'],
      ['completed', '200.00', 'completed'],
      ['partially_completed', '200.00', 'under_review'],
      ['failed', '200.00', 'under_review'],
      ['some_future_state', '200.00', 'under_review'],
    ]

    for (const [status, amount, expected] of outcomes) {
      vi.clearAllMocks()
      setSellerReceivedMock.mockResolvedValue(returnRequest({ status: 'received' }))
      findByIdMock.mockResolvedValue({ id: 'return-1' })
      const refund = {
        id: 'refund-1',
        status,
        customerAmount: new Decimal(amount),
        payment: { method: 'card' },
      }
      executeReturnRefundInTransactionMock.mockResolvedValue(refund)
      const { tx, prisma } = buildTx(returnRequest())
      const service = createReturnService({ prisma: prisma as never })

      await service.confirmReceiptBySeller({ returnRequestId: 'return-1', sellerId: 'seller-1' })

      const [client, payload] = recordNotificationMock.mock.calls[0]!
      expect(client).toBe(tx)
      expect(payload.eventKey).toBe('return:return-1:customer:receipt-approved')
      expect(payload.data.refundOutcome).toBe(expected)
      // The refund record is written inside the transaction; the provider job is not.
      expect(executeReturnRefundInTransactionMock).toHaveBeenCalledWith(tx, expect.objectContaining({ returnRequestId: 'return-1' }))
      expect(dispatchMock).toHaveBeenCalledWith(refund)
      const dispatchOrder = dispatchMock.mock.invocationCallOrder[0]!
      const commitOrder = prisma.$transaction.mock.invocationCallOrder[0]!
      expect(dispatchOrder).toBeGreaterThan(commitOrder)
    }
  })

  it('keeps the first approval and the later refund decision on separate event keys', async () => {
    const approvalTx = buildTx(returnRequest({ status: 'requested' }))
    await createReturnService({ prisma: approvalTx.prisma as never }).reviewRequest({
      returnRequestId: 'return-1',
      adminActorId: 'admin-1',
      decision: 'approved',
    })
    const firstKey = recordNotificationMock.mock.calls[0]![1].eventKey

    recordNotificationMock.mockClear()
    executeReturnRefundInTransactionMock.mockResolvedValue({
      id: 'refund-1',
      status: 'pending',
      customerAmount: new Decimal('200.00'),
      payment: { method: 'card' },
    })
    const receiptTx = buildTx(returnRequest())
    await createReturnService({ prisma: receiptTx.prisma as never }).confirmReceiptBySeller({
      returnRequestId: 'return-1',
      sellerId: 'seller-1',
    })
    const secondKey = recordNotificationMock.mock.calls[0]![1].eventKey

    expect(firstKey).toBe('return:return-1:customer:review:approved')
    expect(secondKey).toBe('return:return-1:customer:receipt-approved')
    expect(firstKey).not.toBe(secondKey)
  })

  it('refuses the seller decision when the status claim is lost to a concurrent request', async () => {
    const { tx, prisma } = buildTx(returnRequest())
    tx.returnRequest.updateMany.mockResolvedValue({ count: 0 })
    const service = createReturnService({ prisma: prisma as never })

    await expect(
      service.confirmReceiptBySeller({ returnRequestId: 'return-1', sellerId: 'seller-1' }),
    ).rejects.toThrow('başka bir işlemle güncellendi')
    expect(recordNotificationMock).not.toHaveBeenCalled()
    expect(executeReturnRefundInTransactionMock).not.toHaveBeenCalled()
  })

  it('authorises a legacy return without sellerId through the order lines of the seller', async () => {
    const legacy = returnRequest({ sellerId: null })
    const { tx, prisma } = buildTx(legacy)
    executeReturnRefundInTransactionMock.mockResolvedValue({
      id: 'refund-1',
      status: 'pending',
      customerAmount: new Decimal('200.00'),
      payment: { method: 'card' },
    })
    const service = createReturnService({ prisma: prisma as never })

    await service.confirmReceiptBySeller({ returnRequestId: 'return-1', sellerId: 'seller-1' })

    expect(tx.returnRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { sellerId: 'seller-1' },
            { sellerId: null, order: { lines: { some: { sellerId: 'seller-1' } } } },
          ],
        }),
      }),
    )
  })
})
