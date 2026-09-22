import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const {
  recordNotificationMock,
  findByIdForSellerMock,
  findByIdMock,
  appendStatusHistoryMock,
  setDeliveryConfirmedMock,
  activateHoldMock,
} = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
  findByIdForSellerMock: vi.fn(),
  findByIdMock: vi.fn(),
  appendStatusHistoryMock: vi.fn(),
  setDeliveryConfirmedMock: vi.fn(),
  activateHoldMock: vi.fn(),
}))

vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: recordNotificationMock,
}))
vi.mock('../../../api/repositories/order.repository', () => ({
  createOrderRepository: vi.fn(() => ({
    findByIdForSeller: findByIdForSellerMock,
    findById: findByIdMock,
    appendStatusHistory: appendStatusHistoryMock,
    setDeliveryConfirmed: setDeliveryConfirmedMock,
    updateStatus: vi.fn(),
  })),
}))
vi.mock('../../../api/repositories/shipment.repository', () => ({
  createShipmentRepository: vi.fn(() => ({})),
}))
vi.mock('../../../api/repositories/admin-audit-log.repository', () => ({
  createAdminAuditLogRepository: vi.fn(() => ({ createEntry: vi.fn() })),
}))
vi.mock('../../../api/services/payout.service', () => ({
  createPayoutService: vi.fn(() => ({ activateHold: activateHoldMock })),
}))

import { createDeliveryService } from '../../../api/services/delivery.service'

const customerOrder = {
  id: 'order-1',
  publicNumber: 26050042,
  customerId: 'customer-1',
  customer: { email: 'customer@example.com', name: 'Ayşe' },
  address: { fullName: 'Ayşe Yılmaz' },
}

describe('delivery.service e-mail producers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.hanuja.com.tr')
  })

  it('records "Siparişiniz Kargoya Verildi" inside the shipping transaction with this shipment quantities and a tracking link', async () => {
    findByIdForSellerMock.mockResolvedValue({
      id: 'order-1',
      quantityLifecycleVersion: 2,
      status: 'seller_accepted',
      shippedAt: null,
    })
    const lines = [
      // 3 ordered, 1 cancelled, 1 already shipped → 1 ships now
      { id: 'line-a', quantity: 3, cancelledQuantity: 1, shippedQuantity: 1, productName: 'Gea Berjer', variantName: null, sellerId: 'seller-1', unitPrice: new Decimal('10.00'), product: { images: [] } },
      // fully shipped earlier → not part of this shipment
      { id: 'line-b', quantity: 1, cancelledQuantity: 0, shippedQuantity: 1, productName: 'Sehpa', variantName: null, sellerId: 'seller-1', unitPrice: new Decimal('20.00'), product: { images: [] } },
    ]
    const tx = {
      orderSellerFulfillment: {
        findUnique: vi.fn().mockResolvedValue({ id: 'f-1', status: 'awaiting_shipment' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderLine: {
        findMany: vi.fn().mockResolvedValue(lines),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      shipment: { upsert: vi.fn().mockResolvedValue({ id: 'ship-1' }) },
      shipmentItem: { create: vi.fn() },
      order: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ ...customerOrder, lines: [lines[0]] }),
      },
      seller: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Atelier Noa' }) },
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    }

    const service = createDeliveryService({ prisma: prisma as never })
    await service.enterTracking({
      orderId: 'order-1',
      sellerId: 'seller-1',
      trackingNumber: 'YK123',
      cargoProvider: 'yurtiçi',
    })

    expect(recordNotificationMock).toHaveBeenCalledTimes(1)
    const [client, payload] = recordNotificationMock.mock.calls[0]!
    expect(client).toBe(tx)
    expect(payload).toMatchObject({
      eventKey: 'order:order-1:shipped:seller-1:YK123',
      userId: 'customer-1',
      emailTo: 'customer@example.com',
      type: 'order_shipped',
    })
    expect(payload.data).toMatchObject({
      orderNumber: '26050042',
      cargoCompany: 'Yurtiçi Kargo',
      trackingNumber: 'YK123',
      trackingUrl: 'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=YK123',
      sellerName: 'Atelier Noa',
      orderUrl: 'https://www.hanuja.com.tr/siparis/order-1',
    })
    // Only the delta shipped now, not the cumulative shippedQuantity.
    expect(payload.data.items).toEqual([
      expect.objectContaining({ productName: 'Gea Berjer', quantity: 1, lineTotal: '10 TL' }),
    ])
    expect(tx.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          lines: expect.objectContaining({ where: { id: { in: ['line-a'] } } }),
        }),
      }),
    )
  })

  it('records a partial then a full "Teslim Edildi" e-mail with distinct, deterministic event keys', async () => {
    findByIdMock.mockResolvedValue({ id: 'order-1', status: 'shipped' })
    const stamp = {
      quantityLifecycleVersion: 2,
      lines: [
        { id: 'line-a', sellerId: 'seller-1', productName: 'Gea', variantName: null, unitPrice: new Decimal('10.00'), quantity: 2, cancelledQuantity: 0, shippedQuantity: 2, product: { images: [] } },
        { id: 'line-b', sellerId: 'seller-1', productName: 'Sehpa', variantName: null, unitPrice: new Decimal('20.00'), quantity: 1, cancelledQuantity: 0, shippedQuantity: 1, product: { images: [] } },
      ],
    }
    let remaining = 1
    const tx = {
      order: {
        findUnique: vi.fn(async (args: { select?: { quantityLifecycleVersion?: boolean } }) =>
          args.select?.quantityLifecycleVersion
            ? { quantityLifecycleVersion: 2 }
            : { ...customerOrder, lines: stamp.lines.filter((l) => currentIds.includes(l.id)) },
        ),
      },
      orderLine: {
        findMany: vi.fn(async () => stamp.lines.filter((l) => currentIds.includes(l.id)).map((l) => ({ id: l.id, sellerId: l.sellerId }))),
        updateMany: vi.fn(),
        count: vi.fn(async () => remaining),
      },
      orderSellerFulfillment: { updateMany: vi.fn() },
    }
    let currentIds = ['line-a']
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    }
    const service = createDeliveryService({ prisma: prisma as never })

    await service.confirmByAdmin({ orderId: 'order-1', adminActorId: 'admin-1', orderLineIds: ['line-a'] })
    expect(activateHoldMock).not.toHaveBeenCalled()
    const first = recordNotificationMock.mock.calls[0]![1]
    expect(first).toMatchObject({ type: 'order_delivery_confirmed', userId: 'customer-1', emailTo: 'customer@example.com' })
    expect(first.data).toMatchObject({ partial: true, orderNumber: '26050042' })
    expect(first.data.items).toEqual([expect.objectContaining({ productName: 'Gea', quantity: 2 })])
    expect(first.eventKey).toMatch(/^order:order-1:delivery-confirmed:[0-9a-f]{16}$/)

    currentIds = ['line-b']
    remaining = 0
    await service.confirmByAdmin({ orderId: 'order-1', adminActorId: 'admin-1' })
    expect(activateHoldMock).toHaveBeenCalledTimes(1)
    const second = recordNotificationMock.mock.calls[1]![1]
    expect(second.data).toMatchObject({ partial: false })
    expect(second.data.items).toEqual([expect.objectContaining({ productName: 'Sehpa', quantity: 1 })])
    expect(second.eventKey).not.toBe(first.eventKey)
  })
})
