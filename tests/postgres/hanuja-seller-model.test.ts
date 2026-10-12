import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createProductQuestionService } from '../../api/services/product-question.service'
import { createQuantityReturnService } from '../../api/services/quantity-return.service'
import { recordReturnCarrierReceipt } from '../../api/services/return-deadline.service'

const raw = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!raw) throw new Error('Disposable local notification test database required')
const url = new URL(raw)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_notification_test') throw new Error('Refusing non-local test database')
const schema = 'hanuja_seller_' + randomUUID().replaceAll('-', '')
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

beforeAll(async () => {
  execFileSync(process.execPath, [resolve('../db/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('../db/schema/schema.prisma')], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' })
  await prisma.$connect()
})
afterAll(async () => {
  if (!/^hanuja_seller_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

async function fixture() {
  const suffix = randomUUID()
  const customer = await prisma.user.create({ data: { email: 'c-' + suffix + '@example.test', role: 'customer' } })
  const sellerUser = await prisma.user.create({ data: { email: 's-' + suffix + '@example.test', role: 'seller' } })
  const admin = await prisma.user.create({ data: { email: 'a-' + suffix + '@example.test', role: 'admin' } })
  const seller = await prisma.seller.create({ data: { userId: sellerUser.id, slug: 'seller-' + suffix, displayName: 'Designer', status: 'active' } })
  const product = await prisma.product.create({ data: { sellerId: seller.id, slug: 'product-' + suffix, name: 'Chair', price: 100, stockQuantity: 5, status: 'published' } })
  const order = await prisma.order.create({ data: {
    customerId: customer.id, status: 'delivery_confirmed', quantityLifecycleVersion: 2, paymentConfirmedAt: new Date(), grossAmount: 100, totalAmount: 100,
    lines: { create: { productId: product.id, sellerId: seller.id, productName: 'Chair', quantity: 1, shippedQuantity: 1, unitPrice: 100, totalPrice: 100, customerPaidProductAmount: 100, netPayoutAmount: 100, deliveredAt: new Date('2026-01-01'), deliveryConfirmedAt: new Date('2026-01-01') } },
  }, include: { lines: true } })
  return { customer, sellerUser, seller, product, order, admin }
}

describe('Hanuja seller model against PostgreSQL', () => {
  it('keeps designer replies and old shared messages invisible to the customer', async () => {
    const f = await fixture()
    const service = createProductQuestionService({ prisma })
    const opened = await service.askQuestion({ customerId: f.customer.id, customerRole: 'customer', productId: f.product.id, body: 'Product question' })
    await service.replyAsSeller({ threadId: opened.threadId, sellerId: f.seller.id, authorUserId: f.sellerUser.id, body: 'Private designer finding' })
    await service.replyAsAdmin({ threadId: opened.threadId, adminId: f.admin.id, audience: 'customer', body: 'Customer answer from Hanuja' })
    await service.replyAsAdmin({ threadId: opened.threadId, adminId: f.admin.id, audience: 'seller', body: 'Private instructions from Hanuja' })
    const customer = await service.getForCustomer(opened.threadId, f.customer.id)
    const seller = await service.getForSeller(opened.threadId, f.seller.id)
    expect(customer?.messages.map((message) => message.body)).toEqual(['Product question', 'Customer answer from Hanuja'])
    expect(seller?.messages.map((message) => message.body)).toEqual(['Private designer finding', 'Private instructions from Hanuja'])
    const notifications = await prisma.notificationOutbox.findMany({ where: { userId: f.customer.id } })
    expect(JSON.stringify(notifications)).not.toContain('Private designer')
    expect(JSON.stringify(notifications)).not.toContain('Private instructions')
  })

  it('allows defect claims after withdrawal expires and preserves a verified refund deadline', async () => {
    const f = await fixture()
    const service = createQuantityReturnService({ prisma })
    const selection = [{ orderLineId: f.order.lines[0]!.id, quantity: 1 }]
    await expect(service.openRequest({ orderId: f.order.id, customerId: f.customer.id, reason: 'Withdrawal', items: selection })).rejects.toMatchObject({ statusCode: 409 })
    const requests = await service.openRequest({ orderId: f.order.id, customerId: f.customer.id, claimType: 'defect', reason: 'Defect', idempotencyKey: 'defect-test', items: selection })
    const repeated = await service.openRequest({ orderId: f.order.id, customerId: f.customer.id, claimType: 'defect', reason: 'Defect', idempotencyKey: 'defect-test', items: selection })
    expect(repeated[0]?.id).toBe(requests[0]?.id)
    const request = requests[0]!
    await recordReturnCarrierReceipt(prisma, request.id, new Date('2026-09-01T10:00:00Z'), f.admin.id)
    await recordReturnCarrierReceipt(prisma, request.id, new Date('2026-09-05T10:00:00Z'), f.admin.id)
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: request.id } })).refundDeadlineAt).toEqual(new Date('2026-09-15T10:00:00Z'))
  })
})
