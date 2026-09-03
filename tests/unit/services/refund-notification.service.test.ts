import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { enqueueNotificationMock } = vi.hoisted(() => ({
  enqueueNotificationMock: vi.fn(),
}))

vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: enqueueNotificationMock,
}))

import { enqueueRefundCompletedNotifications } from '../../../api/services/refund-notification.service'

function buildRefund() {
  return {
    id: 'refund-1',
    status: 'completed',
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

  it('isolates seller refund recipients and product lines while customer sees shipping', async () => {
    const refund = buildRefund()
    const prisma = {
      refundTransaction: {
        findUnique: vi.fn().mockResolvedValue(refund),
      },
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'seller-a',
          displayName: 'Atelier A',
          user: { id: 'seller-user-a', email: 'seller-a@example.com' },
        }),
      },
    }

    await enqueueRefundCompletedNotifications(prisma as never, refund.id)

    expect(enqueueNotificationMock).toHaveBeenCalledTimes(2)
    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventKey: 'refund:refund-1:customer:completed',
        userId: 'customer-user-1',
        emailTo: 'customer@example.com',
        type: 'refund_completed',
        data: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ productName: 'Gea Berjer', sellerId: 'seller-a', quantity: 2 }),
            expect.objectContaining({ productName: 'Meşe Sehpa', sellerId: 'seller-b', quantity: 1 }),
            expect.objectContaining({ productName: 'Kargo', quantity: 1 }),
          ]),
        }),
      }),
    )
    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventKey: 'refund:refund-1:seller:completed',
        userId: 'seller-user-a',
        emailTo: 'seller-a@example.com',
        type: 'seller_refund_completed',
        data: expect.objectContaining({
          sellerId: 'seller-a',
          items: [expect.objectContaining({ productName: 'Gea Berjer', sellerId: 'seller-a' })],
        }),
      }),
    )

    const sellerPayload = enqueueNotificationMock.mock.calls[1]?.[0]
    expect(sellerPayload.data.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sellerId: 'seller-b' })]),
    )
  })

  it('does not enqueue terminal refund emails for a non-completed transaction', async () => {
    const refund = { ...buildRefund(), status: 'processing' }
    const prisma = {
      refundTransaction: { findUnique: vi.fn().mockResolvedValue(refund) },
      seller: { findUnique: vi.fn() },
    }

    await enqueueRefundCompletedNotifications(prisma as never, refund.id)

    expect(enqueueNotificationMock).not.toHaveBeenCalled()
    expect(prisma.seller.findUnique).not.toHaveBeenCalled()
  })
})
