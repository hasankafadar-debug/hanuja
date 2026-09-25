import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createQuantityCancellationService } from '../../api/services/quantity-cancellation.service'
import { createPaymentService } from '../../api/services/payment.service'
import { createQuantityRefundService } from '../../api/services/quantity-refund.service'

vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(async () => undefined),
}))
vi.mock('../../api/jobs/refund-processing.job', () => ({
  enqueueRefundProcessing: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/refund-notification.service', () => ({
  enqueueCustomerRefundCompletedNotification: vi.fn(async () => undefined),
}))

const testUrl = process.env.FINANCE_TEST_DATABASE_URL
if (!testUrl) throw new Error('FINANCE_TEST_DATABASE_URL must point to a disposable local database')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_finance_test') {
  throw new Error('Refusing finance tests outside local hanuja_finance_test database')
}
const schema = `finance_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

beforeAll(async () => {
  execFileSync(process.execPath, [
    resolve('../db/node_modules/prisma/build/index.js'), 'db', 'push',
    '--schema', resolve('../db/schema/schema.prisma'), '--skip-generate',
  ], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' })
  await prisma.$connect()
})

afterAll(async () => {
  // Only the random schema created above is removed; never reset a supplied database.
  if (!/^finance_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

/**
 * A quantity-lifecycle EFT order as checkout leaves it: two lines of one seller
 * (1000 + 500), 3% EFT channel discount (45) spread over the lines, 49.99
 * shipping, total 1504.99, payment pending.
 */
async function eftOrder() {
  const tag = randomUUID()
  const admin = await prisma.user.create({ data: { email: `admin-${tag}@example.test`, role: 'admin' } })
  const customer = await prisma.user.create({ data: { email: `customer-${tag}@example.test`, name: 'Test Müşteri' } })
  const sellerUser = await prisma.user.create({ data: { email: `seller-${tag}@example.test` } })
  const seller = await prisma.seller.create({ data: {
    userId: sellerUser.id, slug: `seller-${tag}`, displayName: 'Test Satıcı', status: 'active',
  } })
  const product = await prisma.product.create({ data: {
    sellerId: seller.id, name: 'Test Sehpa', slug: `product-${tag}`, price: 500, stockQuantity: 5,
  } })
  const order = await prisma.order.create({ data: {
    customerId: customer.id,
    status: 'bank_transfer_waiting',
    quantityLifecycleVersion: 2,
    grossAmount: 1500, eftDiscountAmount: 45, shippingAmount: 49.99, totalAmount: 1504.99,
    sellerFulfillments: { create: [{ sellerId: seller.id, status: 'queue_ready' }] },
  } })
  const lineA = await prisma.orderLine.create({ data: {
    sellerId: seller.id, orderId: order.id, productId: product.id, productName: product.name,
    quantity: 2, unitPrice: 500, totalPrice: 1000, commissionAmount: 180, netPayoutAmount: 820,
    customerPaidProductAmount: 970,
  } })
  const lineB = await prisma.orderLine.create({ data: {
    sellerId: seller.id, orderId: order.id, productId: product.id, productName: product.name,
    quantity: 1, unitPrice: 500, totalPrice: 500, commissionAmount: 90, netPayoutAmount: 410,
    customerPaidProductAmount: 485,
  } })
  const payment = await prisma.payment.create({ data: {
    orderId: order.id, method: 'eft', provider: 'manual_eft', status: 'pending', amount: 1504.99,
  } })
  await prisma.paymentProviderItem.createMany({ data: [
    { paymentId: payment.id, orderLineId: lineA.id, kind: 'product', providerItemId: `line:${lineA.id}`, amount: 970 },
    { paymentId: payment.id, orderLineId: lineB.id, kind: 'product', providerItemId: `line:${lineB.id}`, amount: 485 },
    { paymentId: payment.id, kind: 'shipping', providerItemId: `shipping:${order.id}`, amount: 49.99 },
  ] })
  return {
    orderId: order.id, customerId: customer.id, adminId: admin.id, sellerId: seller.id,
    lineAId: lineA.id, lineBId: lineB.id, paymentId: payment.id,
  }
}

type Fixture = Awaited<ReturnType<typeof eftOrder>>

async function approveAndCancel(f: Fixture, discountAmount?: number) {
  await createPaymentService({ prisma }).approveEftPayment({
    orderId: f.orderId,
    adminActorId: f.adminId,
    evidenceNote: 'Dekont kontrol edildi',
    ...(discountAmount !== undefined
      ? { discountAmount, discountReason: 'Eksik havale kabul edildi' }
      : {}),
  })
  await createQuantityCancellationService({ prisma }).create({
    orderId: f.orderId,
    customerId: f.customerId,
    reason: 'Vazgeçtim',
    items: [{ orderLineId: f.lineAId, quantity: 2 }, { orderLineId: f.lineBId, quantity: 1 }],
  })
  const refunds = await prisma.refundTransaction.findMany({
    where: { orderId: f.orderId }, include: { items: true },
  })
  const sum = (pick: (r: (typeof refunds)[number]) => Decimal) =>
    refunds.reduce((total, refund) => total.add(pick(refund)), new Decimal(0)).toFixed(2)
  return {
    refunds,
    customerRefund: sum((r) => r.customerAmount),
    sellerAdjustment: sum((r) => r.sellerAdjustmentAmount),
    commissionAdjustment: sum((r) => r.commissionAdjustmentAmount),
    couponAdjustment: sum((r) => r.couponAdjustmentAmount),
  }
}

describe('admin discount at EFT approval (Hanuja-absorbed)', () => {
  it('persists the discount on the payment and on customer-paid snapshots only', async () => {
    const f = await eftOrder()
    await createPaymentService({ prisma }).approveEftPayment({
      orderId: f.orderId, adminActorId: f.adminId, evidenceNote: 'Dekont kontrol edildi',
      discountAmount: 15000, discountReason: 'Eksik havale kabul edildi',
    })
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })
    expect(payment.status).toBe('confirmed')
    expect(payment.amount.toFixed(2)).toBe('1354.99')
    expect(payment.eftDiscountAmount!.toFixed(2)).toBe('150.00')
    expect(payment.eftDiscountReason).toBe('Eksik havale kabul edildi')

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: f.orderId }, include: { lines: { orderBy: { totalPrice: 'desc' } } },
    })
    expect(order.totalAmount.toFixed(2)).toBe('1354.99')
    expect(order.lines.map((line) => [
      line.totalPrice.toFixed(2), line.couponDiscountAmount.toFixed(2),
      line.commissionAmount.toFixed(2), line.netPayoutAmount.toFixed(2),
      line.customerPaidProductAmount!.toFixed(2),
    ])).toEqual([
      ['1000.00', '0.00', '180.00', '820.00', '870.00'],
      ['500.00', '0.00', '90.00', '410.00', '435.00'],
    ])

    const providerItems = await prisma.paymentProviderItem.findMany({ where: { paymentId: f.paymentId } })
    const byKey = Object.fromEntries(providerItems.map((item) => [item.orderLineId ?? 'shipping', item.amount.toFixed(2)]))
    expect(byKey).toEqual({ [f.lineAId]: '870.00', [f.lineBId]: '435.00', shipping: '49.99' })

    // Seller accrual is on the undiscounted sale.
    const sale = await prisma.sellerLedgerEntry.aggregate({
      where: { sellerId: f.sellerId, type: 'sale' }, _sum: { amount: true },
    })
    expect(sale._sum.amount!.toFixed(2)).toBe('1500.00')

    // Seller-visible timeline carries no admin note or discount.
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: f.orderId } })
    expect(history.find((row) => row.toStatus === 'seller_queue_ready')!.reason).toBe('Havale onaylandı')
    expect(history.map((row) => row.reason ?? '').join(' ')).not.toMatch(/Dekont kontrol|İndirim|Eksik havale/)

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { targetId: f.paymentId, actionType: 'payment_approved' },
    })
    expect(audit.previousData).toMatchObject({ status: 'pending', amount: '1504.99' })
    expect(audit.newData).toMatchObject({ status: 'confirmed', amount: '1354.99', eftDiscountAmount: '150.00' })
    expect(audit.reason).toBe('Dekont kontrol edildi')
  })

  it('refunds exactly what the customer paid on full cancellation; seller effect equals the no-discount case', async () => {
    const plain = await approveAndCancel(await eftOrder())
    const f = await eftOrder()
    const discounted = await approveAndCancel(f, 15000)

    expect(plain.customerRefund).toBe('1504.99')
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    expect(discounted.customerRefund).toBe(order.totalAmount.toFixed(2))
    expect(discounted.customerRefund).toBe('1354.99')

    expect(discounted.sellerAdjustment).toBe(plain.sellerAdjustment)
    expect(discounted.commissionAdjustment).toBe(plain.commissionAdjustment)
    expect(discounted.couponAdjustment).toBe(plain.couponAdjustment)
    expect(discounted.sellerAdjustment).toBe('1230.00')

    const balance = await prisma.sellerLedgerEntry.aggregate({
      where: { sellerId: f.sellerId }, _sum: { amount: true },
    })
    expect(balance._sum.amount!.toFixed(2)).toBe('0.00')

    // The manual EFT refund completes against the discounted caps without
    // tripping the provider-item or payment remaining-amount guards.
    const quantityRefunds = createQuantityRefundService({ prisma })
    for (const refund of discounted.refunds) {
      await quantityRefunds.complete({
        refundTransactionId: refund.id,
        orderId: f.orderId,
        actorId: f.adminId,
        providerReference: `EFT-${refund.id.slice(0, 8)}`,
        expectedOutstandingAmount: refund.customerAmount.toFixed(2),
      })
    }
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })
    expect(payment.refundedAmount.toFixed(2)).toBe('1354.99')
    expect(payment.refundedAmount.toFixed(2)).toBe(payment.amount.toFixed(2))
  })

  it('rejects a discount above the product amount without confirming the payment', async () => {
    const f = await eftOrder()
    await expect(createPaymentService({ prisma }).approveEftPayment({
      orderId: f.orderId, adminActorId: f.adminId, discountAmount: 145501,
    })).rejects.toThrow('İndirim tutarı ürün tutarını aşamaz')
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })
    expect(payment.status).toBe('pending')
    expect(payment.amount.toFixed(2)).toBe('1504.99')
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(0)
  })
})
