import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { recordNotificationMock } = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
}))

vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: recordNotificationMock,
}))

import { firePaymentConfirmedNotifications } from '../../../api/services/payment.service'

function orderSnapshot(paymentMethod: 'card' | 'eft') {
  return {
    id: 'order-1',
    publicNumber: 26050042,
    totalAmount: new Decimal('149.00'),
    grossAmount: new Decimal('50.00'),
    discountAmount: new Decimal('0'),
    eftDiscountAmount: new Decimal('0'),
    eftDiscountRateSnapshot: null,
    shippingAmount: new Decimal('99.00'),
    couponCode: null,
    customerId: 'customer-user-1',
    customer: { id: 'customer-user-1', email: 'customer@example.com', name: 'Ayşe' },
    address: { fullName: 'Ayşe Yılmaz' },
    payments: [{ method: paymentMethod, status: 'confirmed', eftDiscountAmount: null }],
    lines: [
      {
        id: 'line-a',
        sellerId: 'seller-a',
        productName: 'Gea Berjer',
        variantName: 'Doğal keten',
        quantity: 2,
        cancelledQuantity: 0,
        unitPrice: new Decimal('10.00'),
        totalPrice: new Decimal('20.00'),
        product: { images: [{ url: 'https://media.hanuja.tr/products/gea.jpg', isPrimary: true, sortOrder: 0 }] },
        seller: {
          id: 'seller-a',
          displayName: 'Atelier A',
          user: { id: 'seller-user-a', email: 'seller-a@example.com' },
        },
      },
      {
        id: 'line-b',
        sellerId: 'seller-b',
        productName: 'Meşe Sehpa',
        variantName: null,
        quantity: 1,
        cancelledQuantity: 0,
        unitPrice: new Decimal('30.00'),
        totalPrice: new Decimal('30.00'),
        product: { images: [] },
        seller: {
          id: 'seller-b',
          displayName: 'Atelier B',
          user: { id: 'seller-user-b', email: 'seller-b@example.com' },
        },
      },
    ],
  }
}

describe('payment.service notification dispatch', () => {
  beforeEach(() => {
    recordNotificationMock.mockReset()
    vi.stubEnv('R2_PUBLIC_URL', 'https://media.hanuja.tr')
  })

  it('writes the customer "Siparişiniz Alındı" and per-seller "Yeni Sipariş" through the transaction client for a card order', async () => {
    const tx = { order: { findUnique: vi.fn().mockResolvedValue(orderSnapshot('card')) } }

    await firePaymentConfirmedNotifications(tx as never, 'order-1')

    expect(recordNotificationMock).toHaveBeenCalledTimes(3)
    expect(recordNotificationMock.mock.calls.every((call) => call[0] === tx)).toBe(true)

    const customer = recordNotificationMock.mock.calls[0]![1]
    expect(customer).toMatchObject({
      eventKey: 'order:order-1:payment-confirmed:customer',
      userId: 'customer-user-1',
      emailTo: 'customer@example.com',
      type: 'order_placed',
    })
    expect(customer.data).toMatchObject({
      orderNumber: '26050042',
      paymentMethod: 'card',
      paymentStatus: 'confirmed',
      totalAmount: '149 TL',
      summary: { subtotal: '50 TL', shipping: '99 TL' },
      contracts: {
        preInformationUrl:
          'https://www.hanuja.com.tr/api/orders/order-1/documents/contracts/pre-information?goruntule=1',
        distanceSalesUrl:
          'https://www.hanuja.com.tr/api/orders/order-1/documents/contracts/distance-sales?goruntule=1',
      },
    })
    expect(customer.data.items).toHaveLength(2)
    expect(customer.data.items[0]).toMatchObject({
      productName: 'Gea Berjer',
      quantity: 2,
      imageUrl: 'https://media.hanuja.tr/products/gea.jpg',
    })
    expect(customer.data.items[1].imageUrl).toBeNull()

    const sellerA = recordNotificationMock.mock.calls[1]![1]
    const sellerB = recordNotificationMock.mock.calls[2]![1]
    expect(sellerA).toMatchObject({
      userId: 'seller-user-a',
      emailTo: 'seller-a@example.com',
      type: 'seller_order_received',
      data: expect.objectContaining({ sellerId: 'seller-a', totalAmount: '20 TL' }),
    })
    expect(sellerB).toMatchObject({
      userId: 'seller-user-b',
      emailTo: 'seller-b@example.com',
      type: 'seller_order_received',
      data: expect.objectContaining({ sellerId: 'seller-b', totalAmount: '30 TL' }),
    })
    expect(sellerA.eventKey).not.toBe(sellerB.eventKey)
    expect(sellerA.data.items).toEqual([expect.objectContaining({ productName: 'Gea Berjer' })])
    expect(sellerB.data.items).toEqual([expect.objectContaining({ productName: 'Meşe Sehpa' })])
  })

  it('sends "Ödemeniz Onaylandı" instead of a second "Siparişiniz Alındı" for an approved EFT order', async () => {
    const tx = { order: { findUnique: vi.fn().mockResolvedValue(orderSnapshot('eft')) } }

    await firePaymentConfirmedNotifications(tx as never, 'order-1')

    expect(recordNotificationMock.mock.calls[0]![1]).toMatchObject({
      type: 'order_payment_confirmed',
      data: expect.objectContaining({ paymentMethod: 'eft' }),
    })
  })

  it('records nothing when the order cannot be loaded', async () => {
    const tx = { order: { findUnique: vi.fn().mockResolvedValue(null) } }
    await firePaymentConfirmedNotifications(tx as never, 'missing')
    expect(recordNotificationMock).not.toHaveBeenCalled()
  })
})
