import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { enqueueNotificationMock } = vi.hoisted(() => ({
  enqueueNotificationMock: vi.fn(),
}))

vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: enqueueNotificationMock,
}))

import { enqueueCustomerRefundCompletedNotification } from '../../../api/services/refund-notification.service'

function buildRefund(sourceType: 'cancellation' | 'return_request' | 'dispute' = 'cancellation') {
  return {
    id: 'refund-1',
    status: 'completed',
    sourceType,
    sellerId: 'seller-a',
    customerAmount: new Decimal('47.50'),
    order: {
      id: 'order-1',
      publicNumber: 'HNJ-1001',
      customerId: 'customer-user-1',
      customer: { email: 'customer@example.com', name: 'Ayşe' },
    },
    items: [
      {
        id: 'refund-item-a',
        kind: 'product',
        quantity: 2,
        amount: new Decimal('40.00'),
        createdAt: new Date('2026-09-03T10:00:00.000Z'),
        orderLine: {
          sellerId: 'seller-a',
          productName: 'Gea Berjer',
          variantName: 'Doğal keten',
          unitPrice: new Decimal('20.00'),
        },
      },
      {
        id: 'refund-item-b',
        kind: 'product',
        quantity: 1,
        amount: new Decimal('5.00'),
        createdAt: new Date('2026-09-03T10:01:00.000Z'),
        orderLine: {
          sellerId: 'seller-b',
          productName: 'Meşe Sehpa',
          variantName: null,
          unitPrice: new Decimal('5.00'),
        },
      },
      {
        id: 'refund-item-shipping',
        kind: 'shipping',
        quantity: null,
        amount: new Decimal('2.50'),
        createdAt: new Date('2026-09-03T10:02:00.000Z'),
        orderLine: null,
      },
    ],
  }
}

describe('refund completion notifications', () => {
  beforeEach(() => {
    enqueueNotificationMock.mockReset()
  })

  it.each(['cancellation', 'return_request', 'dispute'] as const)(
    'enqueues only the customer notification for a %s refund',
    async (sourceType) => {
      const refund = buildRefund(sourceType)
      const sellerFindUnique = vi.fn()
      const prisma = {
        refundTransaction: {
          findUnique: vi.fn().mockResolvedValue(refund),
        },
        seller: { findUnique: sellerFindUnique },
      }

      await enqueueCustomerRefundCompletedNotification(prisma as never, refund.id)

      expect(enqueueNotificationMock).toHaveBeenCalledTimes(1)
      expect(enqueueNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          eventKey: 'refund:refund-1:customer:completed',
          userId: 'customer-user-1',
          emailTo: 'customer@example.com',
          type: 'refund_completed',
          data: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({ productName: 'Gea Berjer', quantity: 2 }),
              expect.objectContaining({ productName: 'Meşe Sehpa', quantity: 1 }),
              expect.objectContaining({ productName: 'Kargo', quantity: 1 }),
            ]),
          }),
        }),
      )
      expect(sellerFindUnique).not.toHaveBeenCalled()

      const customerPayload = enqueueNotificationMock.mock.calls[0]?.[0]
      expect(customerPayload.data.items).toHaveLength(3)
      expect(customerPayload.data.items.every((item: object) => !('sellerId' in item))).toBe(true)
    },
  )

  it('does not enqueue terminal refund emails for a non-completed transaction', async () => {
    const refund = { ...buildRefund(), status: 'processing' }
    const prisma = {
      refundTransaction: { findUnique: vi.fn().mockResolvedValue(refund) },
      seller: { findUnique: vi.fn() },
    }

    await enqueueCustomerRefundCompletedNotification(prisma as never, refund.id)

    expect(enqueueNotificationMock).not.toHaveBeenCalled()
    expect(prisma.seller.findUnique).not.toHaveBeenCalled()
  })
})
