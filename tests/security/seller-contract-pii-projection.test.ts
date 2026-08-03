import { describe, expect, it, vi } from 'vitest'

vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))

import { createOrderRepository } from '../../api/repositories/order.repository'
import { createOrderDocumentService } from '../../api/services/order-document.service'

const buyerEmail = 'buyer.private@example.test'
const deliveryPhone = '05321234567'
const deliveryAddress = 'Fulfilment Street 42, Istanbul'

function legalSnapshot() {
  return {
    distanceSalesHtml: `<p><strong>E-posta:</strong> ${buyerEmail}</p><p><strong>Telefon:</strong> ${deliveryPhone}</p><p><strong>Teslimat Adresi:</strong> ${deliveryAddress}</p>`,
    preInformationHtml: `<p><strong>E-posta:</strong> ${buyerEmail}</p><p><strong>Telefon:</strong> ${deliveryPhone}</p><p><strong>Teslimat Adresi:</strong> ${deliveryAddress}</p>`,
    buyerSnapshot: { email: buyerEmail },
    acceptedIp: '203.0.113.17',
  }
}

describe('seller legal contracts â€” buyer account email is removed', () => {
  it('projects the order-detail legal snapshot without mutating the stored snapshot', async () => {
    const storedSnapshot = legalSnapshot()
    const findUnique = async () => ({ id: 'order_1', legalSnapshot: storedSnapshot })
    const repository = createOrderRepository({
      order: { findUnique },
    } as never)

    const order = await repository.findByIdForSeller('order_1', 'seller_1')

    expect(order?.legalSnapshot).toEqual({
      distanceSalesHtml: expect.stringContaining('Gizlendi'),
      preInformationHtml: expect.stringContaining('Gizlendi'),
    })
    expect(JSON.stringify(order?.legalSnapshot)).not.toContain(buyerEmail)
    expect(JSON.stringify(order?.legalSnapshot)).toContain(deliveryPhone)
    expect(JSON.stringify(order?.legalSnapshot)).toContain(deliveryAddress)
    expect(storedSnapshot.distanceSalesHtml).toContain(buyerEmail)
    expect(storedSnapshot.buyerSnapshot.email).toBe(buyerEmail)
  })

  it('projects the contract-download snapshot without buyer email', async () => {
    const storedSnapshot = legalSnapshot()
    const service = createOrderDocumentService({
      prisma: {
        order: {
          findFirst: async () => ({ legalSnapshot: storedSnapshot }),
        },
      } as never,
    })

    const snapshot = await service.getContractForSeller('order_1', 'seller_1')

    expect(JSON.stringify(snapshot)).not.toContain(buyerEmail)
    expect(snapshot.distanceSalesHtml).toContain('Gizlendi')
    expect(snapshot.preInformationHtml).toContain('Gizlendi')
    expect(snapshot.distanceSalesHtml).toContain(deliveryPhone)
    expect(snapshot.preInformationHtml).toContain(deliveryAddress)
    expect(storedSnapshot.distanceSalesHtml).toContain(buyerEmail)
  })
})
