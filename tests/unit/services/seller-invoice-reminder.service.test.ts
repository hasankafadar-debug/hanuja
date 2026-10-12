/**
 * Seller invoice reminder (satıcı Hanuja modeli): cargo entry is never blocked; one hour
 * after shipment a missing invoice to Hanuja triggers a single reminder, without penalty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sweepSellerInvoiceReminders, SELLER_INVOICE_REMINDER_DELAY_MS } from '../../../api/services/seller-invoice-reminder.service'

const NOW = new Date('2026-10-11T12:00:00Z')

function shipment(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `shipment-${String(index).padStart(4, '0')}`,
    orderId: `order-${index}`,
    sellerId: 'seller-1',
    order: { publicNumber: 26050000 + index },
    seller: { userId: 'seller-user', displayName: 'Atelier Noa', user: { email: 'seller@example.test' } },
    ...overrides,
  }
}

function fixture(pages: ReturnType<typeof shipment>[][], invoiced: Array<{ orderId: string; sellerId: string }> = []) {
  const prisma: any = {
    shipment: { findMany: vi.fn() },
    orderSellerInvoice: { findMany: vi.fn().mockResolvedValue(invoiced) },
    notificationOutbox: { createMany: vi.fn(async ({ data }) => ({ count: data.length })) },
  }
  for (const page of pages) prisma.shipment.findMany.mockResolvedValueOnce(page)
  prisma.shipment.findMany.mockResolvedValue([])
  return prisma
}

describe('sweepSellerInvoiceReminders', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://satici.hanuja.com.tr'))

  it('looks only at shipments handed over between one hour and seven days ago', async () => {
    const prisma = fixture([[]])
    await expect(sweepSellerInvoiceReminders({ prisma, now: NOW })).resolves.toEqual({ candidates: 0, reminded: 0 })
    const where = prisma.shipment.findMany.mock.calls[0][0].where
    expect(where.handedAt.lte).toEqual(new Date(NOW.getTime() - SELLER_INVOICE_REMINDER_DELAY_MS))
    expect(where.handedAt.gte).toEqual(new Date('2026-10-04T12:00:00Z'))
    expect(prisma.notificationOutbox.createMany).not.toHaveBeenCalled()
  })

  it('reminds the seller once per order when no invoice arrived, linking to the seller panel', async () => {
    const prisma = fixture([[shipment(1), shipment(2)]], [{ orderId: 'order-2', sellerId: 'seller-1' }])
    await expect(sweepSellerInvoiceReminders({ prisma, now: NOW })).resolves.toEqual({ candidates: 2, reminded: 1 })
    const { data, skipDuplicates } = prisma.notificationOutbox.createMany.mock.calls[0][0]
    expect(skipDuplicates).toBe(true)
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      eventKey: 'seller-invoice-reminder:order-1:seller-1',
      userId: 'seller-user',
      type: 'seller_invoice_reminder',
      lane: 'transactional',
      payload: expect.objectContaining({
        emailTo: 'seller@example.test',
        data: expect.objectContaining({
          orderId: 'order-1',
          orderNumber: '26050001',
          panelUrl: 'https://satici.hanuja.com.tr/siparisler/order-1',
        }),
      }),
    })
  })

  it('counts only newly written reminders so repeated runs stay quiet', async () => {
    const prisma = fixture([[shipment(1)]])
    prisma.notificationOutbox.createMany.mockResolvedValueOnce({ count: 0 })
    await expect(sweepSellerInvoiceReminders({ prisma, now: NOW })).resolves.toEqual({ candidates: 1, reminded: 0 })
  })

  it('visits every page so later shipments are not starved', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => shipment(index + 1))
    const prisma = fixture([firstPage, [shipment(501)]])
    const result = await sweepSellerInvoiceReminders({ prisma, now: NOW })
    expect(result).toEqual({ candidates: 501, reminded: 501 })
    expect(prisma.shipment.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.shipment.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'shipment-0500' }, skip: 1, orderBy: { id: 'asc' },
    })
  })
})
