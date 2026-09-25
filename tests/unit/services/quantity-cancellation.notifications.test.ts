import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { recordNotificationMock } = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
}))

vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: recordNotificationMock,
}))
vi.mock('../../../api/services/quantity-refund.service', () => ({
  createQuantityRefundService: vi.fn(() => ({ queue: vi.fn() })),
}))

import { createQuantityCancellationService } from '../../../api/services/quantity-cancellation.service'

const order = {
  id: 'order-1',
  publicNumber: 26050042,
  customerId: 'customer-1',
  customer: { email: 'customer@example.com', name: 'Ayşe' },
  address: { fullName: 'Ayşe Yılmaz' },
  payments: [{ method: 'card' as const }],
  // 3 items ordered in total; the operation below cancels 1 → partial
  lines: [
    { id: 'line-a', productId: 'product-a', quantity: 2 },
    { id: 'line-b', productId: 'product-b', quantity: 1 },
  ],
}

const operation = {
  id: 'cancel-1',
  sellerId: 'seller-1',
  reason: 'Stok kalmadı',
  customerRefundAmount: new Decimal('4850.00'),
  items: [
    {
      quantity: 1,
      orderLine: {
        id: 'line-a',
        productId: 'product-a',
        productName: 'Gea Berjer',
        variantName: 'Doğal keten',
        unitPrice: new Decimal('4850.00'),
      },
    },
  ],
}

function buildTx() {
  return {
    seller: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'seller-1',
          displayName: 'Atelier Noa',
          user: { id: 'seller-user-1', email: 'seller@example.com' },
        },
      ]),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'admin-1' }]) },
    adminNotificationRecipient: {
      findUnique: vi.fn().mockResolvedValue({ email: 'admin@hanuja.com.tr' }),
    },
    productImage: {
      findMany: vi.fn().mockResolvedValue([
        { productId: 'product-a', url: 'https://media.hanuja.tr/products/gea.jpg', isPrimary: true, sortOrder: 0 },
      ]),
    },
  }
}

describe('quantity cancellation notifications', () => {
  beforeEach(() => {
    recordNotificationMock.mockReset()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_SELLER_PANEL_URL', 'https://satici.hanuja.com.tr')
    vi.stubEnv('R2_PUBLIC_URL', 'https://media.hanuja.tr')
  })

  it('mails the customer and the seller when the customer cancels, marking the partial scope and refund', async () => {
    const tx = buildTx()
    const service = createQuantityCancellationService({ prisma: {} as never })
    await service.recordCancellationNotifications(tx as never, order as never, [operation] as never, {
      actorRole: 'customer',
    })

    const [customerCall, sellerCall, adminCall, opsCall] =
      recordNotificationMock.mock.calls.map((call) => call[1])
    expect(recordNotificationMock).toHaveBeenCalledTimes(4)
    expect(customerCall).toMatchObject({
      eventKey: 'cancellation:cancel-1:customer',
      userId: 'customer-1',
      emailTo: 'customer@example.com',
      type: 'order_cancelled',
    })
    expect(customerCall.data).toMatchObject({
      orderNumber: '26050042',
      actorRole: 'customer',
      partial: true,
      paymentMethod: 'card',
      refundAmount: '4.850 TL',
      cancellationReason: 'Stok kalmadı',
      orderUrl: 'https://www.hanuja.com.tr/siparis/order-1',
    })
    expect(customerCall.data.items).toEqual([
      expect.objectContaining({
        productName: 'Gea Berjer',
        quantity: 1,
        imageUrl: 'https://media.hanuja.tr/products/gea.jpg',
      }),
    ])

    expect(sellerCall).toMatchObject({
      eventKey: 'cancellation:cancel-1:seller',
      userId: 'seller-user-1',
      emailTo: 'seller@example.com',
      type: 'order_canceled',
    })
    expect(sellerCall.data).toMatchObject({
      sellerName: 'Atelier Noa',
      panelUrl: 'https://satici.hanuja.com.tr/siparisler/order-1',
    })
    // Seller-bound data never carries the customer's refund amount, even
    // though the customer copy above does.
    expect(sellerCall.data).not.toHaveProperty('refundAmount')

    // Admin copy stays in-app: no e-mail address is attached.
    expect(adminCall).toMatchObject({ userId: 'admin-1', type: 'order_canceled' })
    expect(adminCall.emailTo).toBeUndefined()

    // One operations e-mail for the event, regardless of how many admins exist.
    expect(opsCall).toMatchObject({
      eventKey: 'cancellation:cancel-1:ops',
      userId: 'ops',
      type: 'admin_order_cancellation',
      emailTo: 'admin@hanuja.com.tr',
    })
    expect(opsCall.data).toMatchObject({
      orderNumber: '26050042',
      actorLabel: 'Müşteri',
      sellerName: 'Atelier Noa',
      refundAmount: '4.850 TL',
      reason: 'Stok kalmadı',
      adminUrl: 'https://admin.hanuja.com.tr/siparisler/order-1',
    })
  })

  it('does not mail the seller its own rejection but still tells the customer', async () => {
    const tx = buildTx()
    const service = createQuantityCancellationService({ prisma: {} as never })
    await service.recordCancellationNotifications(tx as never, order as never, [operation] as never, {
      actorRole: 'seller',
    })

    const recipients = recordNotificationMock.mock.calls.map((call) => call[1].userId)
    // 'ops' is the operations mailbox row: one e-mail per event, no user account.
    expect(recipients).toEqual(['customer-1', 'admin-1', 'ops'])
    expect(recordNotificationMock.mock.calls[0]![1].data.actorRole).toBe('seller')
  })

  it('keeps an unpaid EFT cancellation away from the seller and promises no refund', async () => {
    const tx = buildTx()
    const service = createQuantityCancellationService({ prisma: {} as never })
    await service.recordCancellationNotifications(
      tx as never,
      {
        ...order,
        payments: [{ method: 'eft' as const }],
        lines: [{ id: 'line-a', productId: 'product-a', quantity: 1 }],
      } as never,
      [{ ...operation, customerRefundAmount: new Decimal('0') }] as never,
      {
        actorRole: 'customer',
        paymentCollected: false,
        netAmountByOperationId: new Map([['cancel-1', new Decimal('56939.00')]]),
      },
    )

    const calls = recordNotificationMock.mock.calls.map((call) => call[1])
    // No seller row: the seller never saw an order whose payment was not confirmed.
    expect(calls.map((call) => call.userId)).toEqual(['customer-1', 'admin-1', 'ops'])

    const [customerCall, , opsCall] = calls
    expect(customerCall.data).toMatchObject({ paymentMethod: 'eft', paymentNotCollected: true })
    expect(customerCall.data).not.toHaveProperty('refundAmount')

    expect(opsCall.data).toMatchObject({ paymentCollected: false, netAmount: '56.939 TL' })
    expect(opsCall.data).not.toHaveProperty('refundAmount')
  })

  it('marks a cancellation covering every ordered unit as full', async () => {
    const tx = buildTx()
    const service = createQuantityCancellationService({ prisma: {} as never })
    await service.recordCancellationNotifications(
      tx as never,
      { ...order, lines: [{ id: 'line-a', productId: 'product-a', quantity: 1 }] } as never,
      [operation] as never,
      { actorRole: 'admin' },
    )
    expect(recordNotificationMock.mock.calls[0]![1].data.partial).toBe(false)
  })
})
