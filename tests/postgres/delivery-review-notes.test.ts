import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createSellerDeliveryReportService } from '../../api/services/seller-delivery-report.service'
import { createAdminDeliveryQueryService } from '../../api/services/admin-delivery-query.service'
import { createAdminOrderNoteService } from '../../api/services/admin-order-note.service'
import { createOrderRepository } from '../../api/repositories/order.repository'
import { createDeliveryService } from '../../api/services/delivery.service'

const { activateHold } = vi.hoisted(() => ({
  activateHold: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/payout.service', () => ({
  createPayoutService: () => ({ activateHold }),
}))

const testUrl = process.env.FINANCE_TEST_DATABASE_URL
if (!testUrl) throw new Error('FINANCE_TEST_DATABASE_URL must point to a disposable local database')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_finance_test') {
  throw new Error('Refusing delivery tests outside local hanuja_finance_test database')
}
const schema = `delivery_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({
  datasources: { db: { url: url.toString() } },
})
beforeAll(async () => {
  execFileSync(
    process.execPath,
    [
      resolve('../db/node_modules/prisma/build/index.js'),
      'db',
      'push',
      '--schema',
      resolve('../db/schema/schema.prisma'),
      '--skip-generate',
    ],
    {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    },
  )
  await prisma.$connect()
})
afterAll(async () => {
  if (!/^delivery_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

async function fixture(version = 2) {
  const tag = randomUUID()
  const admin = await prisma.user.create({
    data: {
      email: `admin-${tag}@example.test`,
      name: 'Operasyon Admin',
      role: 'admin',
    },
  })
  const customer = await prisma.user.create({
    data: { email: `customer-${tag}@example.test`, name: 'Test Müşteri' },
  })
  const sellers = await Promise.all(
    [1, 2].map(async (n) => {
      const user = await prisma.user.create({
        data: { email: `seller-${n}-${tag}@example.test`, role: 'seller' },
      })
      return prisma.seller.create({
        data: {
          userId: user.id,
          slug: `seller-${n}-${tag}`,
          displayName: `Satıcı ${n}`,
          status: 'active',
        },
      })
    }),
  )
  const shippedAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      status: 'shipped',
      quantityLifecycleVersion: version,
      grossAmount: 300,
      totalAmount: 300,
      paymentConfirmedAt: shippedAt,
      shippedAt,
    },
  })
  const lines = []
  for (const [index, seller] of sellers.entries()) {
    const product = await prisma.product.create({
      data: {
        sellerId: seller.id,
        name: `Ürün ${index + 1}`,
        slug: `product-${index}-${tag}`,
        price: 100,
      },
    })
    lines.push(
      await prisma.orderLine.create({
        data: {
          orderId: order.id,
          sellerId: seller.id,
          productId: product.id,
          productName: product.name,
          quantity: index === 0 ? 2 : 1,
          unitPrice: 100,
          totalPrice: index === 0 ? 200 : 100,
          commissionAmount: 0,
          netPayoutAmount: index === 0 ? 200 : 100,
          shippedQuantity: index === 0 && version === 2 ? 2 : 0,
          fulfilledAt: index === 0 ? shippedAt : null,
        },
      }),
    )
    await prisma.shipment.create({
      data: {
        orderId: order.id,
        sellerId: seller.id,
        cargoProvider: `Kargo ${index + 1}`,
        trackingNumber: `TRACK-${index + 1}`,
        status: index === 0 ? 'handed_to_cargo' : 'preparing',
        handedAt: index === 0 ? shippedAt : null,
      },
    })
    if (version === 2)
      await prisma.orderSellerFulfillment.create({
        data: {
          orderId: order.id,
          sellerId: seller.id,
          status: index === 0 ? 'shipped' : 'preparing',
          shippedAt: index === 0 ? shippedAt : null,
        },
      })
  }
  return { order, lines, sellers, admin, customer, shippedAt }
}

describe('delivery reports, definitive confirmation and private notes in PostgreSQL', () => {
  it('isolates sellers, preserves first report under concurrency and matches distinct queue counts', async () => {
    const f = await fixture()
    const reports = createSellerDeliveryReportService({ prisma })
    const params = {
      orderId: f.order.id,
      sellerId: f.sellers[0]!.id,
      actorId: f.sellers[0]!.userId,
    }
    const results = await Promise.all([
      reports.report(params),
      reports.report(params),
      reports.report(params),
    ])
    expect(new Set(results.map((r) => r.reportedAt.toISOString())).size).toBe(1)
    expect(results[0]!.reportedLineIds).toEqual([f.lines[0]!.id])
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: f.order.id },
      include: { lines: true, payouts: true },
    })
    expect(order.status).toBe('shipped')
    expect(order.deliveredAt).toBeNull()
    expect(order.deliveryConfirmedAt).toBeNull()
    expect(order.payouts).toHaveLength(0)
    expect(order.lines.find((l) => l.id === f.lines[1]!.id)?.sellerDeliveryReportedAt).toBeNull()
    const query = createAdminDeliveryQueryService({ prisma })
    const counts = await query.getCounts({ sellerReported: true })
    const queue = await query.listForAdmin({ sellerReported: true, take: 1 })
    expect(counts).toEqual({ orderCount: 1, lineCount: 1 })
    expect(
      queue.lines[0]?.order.shipments.find((s) => s.sellerId === queue.lines[0]!.sellerId)
        ?.trackingNumber,
    ).toBe('TRACK-1')
    await expect(reports.report({ ...params, sellerId: f.sellers[1]!.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(reports.report({ ...params, sellerId: 'unrelated' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await prisma.order.update({
      where: { id: f.order.id },
      data: { paymentConfirmedAt: null },
    })
    await expect(reports.report(params)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('confirms only selected shipped products and leaves the unshipped seller active', async () => {
    activateHold.mockClear()
    const f = await fixture()
    const report = createSellerDeliveryReportService({ prisma })
    await report.report({
      orderId: f.order.id,
      sellerId: f.sellers[0]!.id,
      actorId: f.sellers[0]!.userId,
    })
    const delivery = createDeliveryService({ prisma })
    await expect(
      delivery.confirmByAdmin({
        orderId: f.order.id,
        adminActorId: f.admin.id,
        orderLineIds: [f.lines[1]!.id],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const partial = await delivery.confirmByAdmin({
      orderId: f.order.id,
      adminActorId: f.admin.id,
      orderLineIds: [f.lines[0]!.id],
    })
    expect(partial.allLinesConfirmed).toBe(false)
    expect(activateHold).not.toHaveBeenCalled()
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe(
      'shipped',
    )
    expect(
      (
        await prisma.orderLine.findUniqueOrThrow({
          where: { id: f.lines[1]!.id },
        })
      ).deliveryConfirmedAt,
    ).toBeNull()
    const queue = await createAdminDeliveryQueryService({
      prisma,
    }).listForAdmin({ sellerReported: true })
    expect(queue.lines.some((line) => line.order.id === f.order.id)).toBe(false)
    expect(
      (
        await prisma.orderLine.findUniqueOrThrow({
          where: { id: f.lines[0]!.id },
        })
      ).sellerDeliveryReportedAt,
    ).not.toBeNull()
    await prisma.orderLine.update({
      where: { id: f.lines[1]!.id },
      data: { shippedQuantity: 1, fulfilledAt: new Date() },
    })
    const final = await delivery.confirmByAdmin({
      orderId: f.order.id,
      adminActorId: f.admin.id,
      orderLineIds: [f.lines[1]!.id],
    })
    expect(final.allLinesConfirmed).toBe(true)
    expect(activateHold).toHaveBeenCalledTimes(1)
  })

  it('counts one order across two reported sellers and keeps the second pending after partial confirmation', async () => {
    const f = await fixture()
    await prisma.orderLine.update({
      where: { id: f.lines[1]!.id },
      data: { shippedQuantity: 1, fulfilledAt: new Date() },
    })
    const report = createSellerDeliveryReportService({ prisma })
    for (const seller of f.sellers)
      await report.report({
        orderId: f.order.id,
        sellerId: seller.id,
        actorId: seller.userId,
      })
    const query = createAdminDeliveryQueryService({ prisma })
    const before = await query.listForAdmin({ sellerReported: true })
    expect(before.lines.filter((line) => line.order.id === f.order.id)).toHaveLength(2)
    await createDeliveryService({ prisma }).confirmByAdmin({
      orderId: f.order.id,
      adminActorId: f.admin.id,
      orderLineIds: [f.lines[0]!.id],
    })
    const after = await query.listForAdmin({ sellerReported: true })
    expect(
      after.lines.filter((line) => line.order.id === f.order.id).map((line) => line.id),
    ).toEqual([f.lines[1]!.id])
  })

  it('supports legacy shipping timestamps and excludes unshipped products from the general queue', async () => {
    const f = await fixture(1)
    const report = createSellerDeliveryReportService({ prisma })
    const params = {
      orderId: f.order.id,
      sellerId: f.sellers[0]!.id,
      actorId: f.sellers[0]!.userId,
    }
    expect((await report.report(params)).reportedLineIds).toEqual([f.lines[0]!.id])
    const queue = await createAdminDeliveryQueryService({
      prisma,
    }).listForAdmin()
    expect(
      queue.lines.filter((line) => line.order.id === f.order.id).map((line) => line.id),
    ).toEqual([f.lines[0]!.id])
  })

  it('stores admin notes with server time and author but never exposes them in participant order data', async () => {
    const f = await fixture()
    const service = createAdminOrderNoteService({ prisma })
    const before = Date.now()
    const note = await service.add({
      orderId: f.order.id,
      authorId: f.admin.id,
      body: ' Müşteri arandı.\nTeslim teyidi alındı. ',
    })
    expect(note.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
    const stored = await prisma.orderAdminNote.findUniqueOrThrow({
      where: { id: note.id },
      include: { author: true },
    })
    expect(stored.body).toBe('Müşteri arandı.\nTeslim teyidi alındı.')
    expect(stored.author.name).toBe('Operasyon Admin')
    expect(
      await prisma.adminAuditLog.count({
        where: { targetId: f.order.id, actionType: 'order_admin_note_added' },
      }),
    ).toBe(1)
    await expect(
      service.add({
        orderId: f.order.id,
        authorId: f.customer.id,
        body: 'private',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.add({
        orderId: 'missing',
        authorId: f.admin.id,
        body: 'private',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const repo = createOrderRepository(prisma)
    for (const result of [
      await repo.findByIdForCustomer(f.order.id, f.customer.id),
      await repo.findByIdForSeller(f.order.id, f.sellers[0]!.id),
      await repo.listByCustomer({ customerId: f.customer.id }),
    ]) {
      expect(JSON.stringify(result)).not.toContain(stored.body)
      expect(JSON.stringify(result)).not.toContain('adminNotes')
    }
  })
})
