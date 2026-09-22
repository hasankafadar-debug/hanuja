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

import { createQuantityReturnService } from '../../../api/services/quantity-return.service'

const orderLine = {
  productId: 'product-a',
  productName: 'Gea Berjer',
  variantName: 'Doğal keten',
  unitPrice: new Decimal('4850.00'),
}

const order = {
  id: 'order-1',
  publicNumber: 26050042,
  customerId: 'customer-1',
  customer: { email: 'customer@example.com', name: 'Ayşe' },
  address: { fullName: 'Ayşe Yılmaz' },
}

function buildTx(extra: Record<string, unknown> = {}) {
  return {
    seller: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'seller-1', displayName: 'Atelier Noa', user: { id: 'seller-user-1', email: 'seller@example.com' } },
      ]),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'admin-1' }]) },
    productImage: { findMany: vi.fn().mockResolvedValue([]) },
    order: { findUnique: vi.fn().mockResolvedValue(order) },
    ...extra,
  }
}

describe('quantity return notifications', () => {
  beforeEach(() => {
    recordNotificationMock.mockReset()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_SELLER_PANEL_URL', 'https://satici.hanuja.com.tr')
  })

  it('records customer, seller and admin notifications when a return is opened', async () => {
    const service = createQuantityReturnService({ prisma: {} as never })
    const tx = buildTx()
    await service.recordReturnOpenedNotifications(tx as never, order as never, [
      {
        id: 'return-1',
        sellerId: 'seller-1',
        reason: 'Ürün hasarlı geldi',
        items: [{ requestedQuantity: 1, orderLine }],
      },
    ] as never)

    const [customer, seller, admin] = recordNotificationMock.mock.calls.map((call) => call[1])
    expect(customer).toMatchObject({
      eventKey: 'return:return-1:customer:requested',
      emailTo: 'customer@example.com',
      type: 'return_requested',
    })
    expect(customer.data).toMatchObject({ orderNumber: '26050042', returnReason: 'Ürün hasarlı geldi' })
    expect(customer.data.items).toEqual([expect.objectContaining({ productName: 'Gea Berjer', quantity: 1 })])
    expect(seller).toMatchObject({
      emailTo: 'seller@example.com',
      type: 'seller_return_request',
      data: expect.objectContaining({ panelUrl: 'https://satici.hanuja.com.tr/iadeler/return-1' }),
    })
    expect(admin.emailTo).toBeUndefined()
  })

  it('classifies the receipt decision per line and reports the dispute on rejection', async () => {
    const service = createQuantityReturnService({ prisma: {} as never })
    const request = {
      id: 'return-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      items: [
        { id: 'item-a', requestedQuantity: 2, orderLine },
        { id: 'item-b', requestedQuantity: 1, orderLine: { ...orderLine, productName: 'Sehpa' } },
      ],
    }

    // Partial: one line accepted, one rejected.
    await service.recordReturnDecisionNotification(
      buildTx() as never,
      request as never,
      [
        { returnRequestItemId: 'item-a', acceptedQuantity: 2, rejectedQuantity: 0 },
        { returnRequestItemId: 'item-b', acceptedQuantity: 0, rejectedQuantity: 1, rejectionReason: 'Kullanılmış' },
      ],
      { refundAmount: new Decimal('9700.00'), disputeOpened: true },
    )
    const partial = recordNotificationMock.mock.calls[0]![1]
    expect(partial).toMatchObject({
      eventKey: 'return:return-1:customer:decision',
      emailTo: 'customer@example.com',
      type: 'order_return_approved',
    })
    expect(partial.data).toMatchObject({ decision: 'partial', disputeOpened: true, refundAmount: '9.700 TL' })
    expect(partial.data.items).toEqual([
      expect.objectContaining({ acceptedQuantity: 2, rejectedQuantity: 0, rejectionReason: null }),
      expect.objectContaining({ acceptedQuantity: 0, rejectedQuantity: 1, rejectionReason: 'Kullanılmış' }),
    ])

    recordNotificationMock.mockReset()
    await service.recordReturnDecisionNotification(
      buildTx() as never,
      request as never,
      [
        { returnRequestItemId: 'item-a', acceptedQuantity: 2, rejectedQuantity: 0 },
        { returnRequestItemId: 'item-b', acceptedQuantity: 1, rejectedQuantity: 0 },
      ],
      { refundAmount: new Decimal('9700.00'), disputeOpened: false },
    )
    expect(recordNotificationMock.mock.calls[0]![1].data.decision).toBe('approved')

    recordNotificationMock.mockReset()
    await service.recordReturnDecisionNotification(
      buildTx() as never,
      request as never,
      [
        { returnRequestItemId: 'item-a', acceptedQuantity: 0, rejectedQuantity: 2, rejectionReason: 'Hasar yok' },
        { returnRequestItemId: 'item-b', acceptedQuantity: 0, rejectedQuantity: 1, rejectionReason: 'Hasar yok' },
      ],
      { refundAmount: new Decimal('0'), disputeOpened: true },
    )
    const rejected = recordNotificationMock.mock.calls[0]![1]
    expect(rejected.type).toBe('order_return_rejected')
    expect(rejected.data).toMatchObject({ decision: 'rejected', disputeOpened: true })
    expect(rejected.data.refundAmount).toBeUndefined()
  })
})
