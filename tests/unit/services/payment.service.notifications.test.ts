import { describe, expect, it, vi } from 'vitest'

const { enqueueNotificationMock } = vi.hoisted(() => ({
  enqueueNotificationMock: vi.fn(),
}))

vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: enqueueNotificationMock,
}))

import { firePaymentConfirmedNotifications } from '../../../api/services/payment.service'

describe('payment.service notification dispatch', () => {
  it('uses the seller user id when notifying the seller about a paid order', async () => {
    enqueueNotificationMock.mockReset()

    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          customerId: 'customer-user-1',
          lines: [{ seller: { userId: 'seller-user-1' } }],
        }),
      },
    }

    await firePaymentConfirmedNotifications(prisma as never, 'order-1')

    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'customer-user-1',
        type: 'order_payment_confirmed',
      }),
    )
    expect(enqueueNotificationMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'seller-user-1',
        type: 'seller_order_received',
      }),
    )
  })
})
