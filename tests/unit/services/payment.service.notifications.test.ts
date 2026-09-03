import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { enqueueNotificationMock } = vi.hoisted(() => ({
  enqueueNotificationMock: vi.fn(),
}))

vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: enqueueNotificationMock,
}))

import { firePaymentConfirmedNotifications } from '../../../api/services/payment.service'

describe('payment.service notification dispatch', () => {
  it('isolates customer and per-seller recipients and line content for a paid order', async () => {
    enqueueNotificationMock.mockReset()

    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          publicNumber: 'HNJ-1001',
          totalAmount: new Decimal('50.00'),
          customerId: 'customer-user-1',
          customer: { email: 'customer@example.com', name: 'Ayşe' },
          payments: [{ method: 'card' }],
          lines: [
            {
              sellerId: 'seller-a',
              productName: 'Gea Berjer',
              variantName: 'Doğal keten',
              quantity: 2,
              unitPrice: new Decimal('10.00'),
              totalPrice: new Decimal('20.00'),
              seller: {
                displayName: 'Atelier A',
                user: { id: 'seller-user-a', email: 'seller-a@example.com' },
              },
            },
            {
              sellerId: 'seller-b',
              productName: 'Meşe Sehpa',
              variantName: null,
              quantity: 1,
              unitPrice: new Decimal('30.00'),
              totalPrice: new Decimal('30.00'),
              seller: {
                displayName: 'Atelier B',
                user: { id: 'seller-user-b', email: 'seller-b@example.com' },
              },
            },
          ],
        }),
      },
    }

    await firePaymentConfirmedNotifications(prisma as never, 'order-1')

    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'customer-user-1',
        emailTo: 'customer@example.com',
        type: 'order_payment_confirmed',
      }),
    )
    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'seller-user-a',
        emailTo: 'seller-a@example.com',
        type: 'seller_order_received',
        data: expect.objectContaining({
          sellerId: 'seller-a',
          totalAmount: '20 TL',
          items: [
            expect.objectContaining({
              sellerId: 'seller-a',
              productName: 'Gea Berjer',
            }),
          ],
        }),
      }),
    )
    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        userId: 'seller-user-b',
        emailTo: 'seller-b@example.com',
        type: 'seller_order_received',
        data: expect.objectContaining({
          sellerId: 'seller-b',
          totalAmount: '30 TL',
          items: [
            expect.objectContaining({
              sellerId: 'seller-b',
              productName: 'Meşe Sehpa',
            }),
          ],
        }),
      }),
    )
    expect(enqueueNotificationMock).toHaveBeenCalledTimes(3)

    const sellerA = enqueueNotificationMock.mock.calls[1]?.[0]
    const sellerB = enqueueNotificationMock.mock.calls[2]?.[0]
    expect(sellerA.eventKey).not.toBe(sellerB.eventKey)
    expect(sellerA.data.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sellerId: 'seller-b' })]),
    )
    expect(sellerB.data.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sellerId: 'seller-a' })]),
    )
  })
})
