import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createQuantityCancellationService } from '../../api/services/quantity-cancellation.service'
import { createPaymentService } from '../../api/services/payment.service'
import { createOrderService } from '../../api/services/order.service'
import { createQuantityRefundService } from '../../api/services/quantity-refund.service'
import { createAdminRefundQueryService } from '../../api/services/admin-refund-query.service'
import { createOrderRepository } from '../../api/repositories/order.repository'
import { reconcileFinance } from '../../api/services/finance-reconciliation.service'
import {
  applyRepair,
  describeRepair,
  findUnpaidCancellationRefunds,
} from '../../tools/scripts/repair-unpaid-cancellation-refunds'

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

const STOCK_AFTER_CHECKOUT = 3

/**
 * An EFT order as checkout leaves it: 2 units of one product reserved from
 * stock, payment pending, waiting for the admin to confirm the transfer.
 */
async function eftOrder(options: { paid?: boolean; method?: 'eft' | 'card' } = {}) {
  const tag = randomUUID()
  const method = options.method ?? 'eft'
  const admin = await prisma.user.create({ data: { email: `admin-${tag}@example.test`, role: 'admin' } })
  const customer = await prisma.user.create({ data: { email: `customer-${tag}@example.test`, name: 'Test Müşteri' } })
  const sellerUser = await prisma.user.create({ data: { email: `seller-${tag}@example.test` } })
  const seller = await prisma.seller.create({ data: {
    userId: sellerUser.id, slug: `seller-${tag}`, displayName: 'Test Satıcı', status: 'active',
  } })
  const product = await prisma.product.create({ data: {
    sellerId: seller.id, name: 'Test Sehpa', slug: `product-${tag}`, price: 500,
    stockQuantity: STOCK_AFTER_CHECKOUT,
  } })
  const paidAt = new Date('2026-09-01T10:00:00Z')
  const order = await prisma.order.create({ data: {
    customerId: customer.id,
    status: options.paid ? 'seller_queue_ready' : method === 'eft' ? 'bank_transfer_waiting' : 'payment_pending',
    quantityLifecycleVersion: 2,
    grossAmount: 1000, eftDiscountAmount: method === 'eft' ? 30 : 0,
    totalAmount: method === 'eft' ? 970 : 1000,
    ...(options.paid ? { paymentConfirmedAt: paidAt } : {}),
    sellerFulfillments: { create: [{ sellerId: seller.id, status: 'queue_ready' }] },
  } })
  const line = await prisma.orderLine.create({ data: {
    sellerId: seller.id, orderId: order.id, productId: product.id, productName: product.name,
    quantity: 2, unitPrice: 500, totalPrice: 1000, commissionAmount: 180, netPayoutAmount: 820,
    customerPaidProductAmount: method === 'eft' ? 970 : 1000,
  } })
  const payment = await prisma.payment.create({ data: {
    orderId: order.id, method, provider: method === 'eft' ? 'manual_eft' : 'iyzico',
    status: options.paid ? 'confirmed' : 'pending', amount: method === 'eft' ? 970 : 1000,
    ...(options.paid ? { confirmedAt: paidAt } : {}),
  } })
  await prisma.paymentProviderItem.create({ data: {
    paymentId: payment.id, orderLineId: line.id, kind: 'product', providerItemId: `line:${line.id}`,
    amount: method === 'eft' ? 970 : 1000,
  } })
  if (options.paid) {
    await prisma.sellerLedgerEntry.create({ data: {
      sellerId: seller.id, type: 'sale', amount: 1000, balanceAfter: 1000,
      eventKey: `payment-confirmed:sale:${order.id}:${seller.id}`,
      referenceType: 'order', referenceId: order.id, visibleToSeller: true,
    } })
  }
  return {
    orderId: order.id, customerId: customer.id, adminId: admin.id, sellerId: seller.id,
    sellerUserId: sellerUser.id, productId: product.id, lineId: line.id, paymentId: payment.id,
  }
}

const cancelAll = (f: Awaited<ReturnType<typeof eftOrder>>, quantity = 2) =>
  createQuantityCancellationService({ prisma }).create({
    orderId: f.orderId,
    customerId: f.customerId,
    reason: 'Yanlışlıkla sipariş verdim',
    items: [{ orderLineId: f.lineId, quantity }],
  })

async function stockOf(productId: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity
}

describe('cancelling an EFT order before the transfer is confirmed', () => {
  it('releases stock and closes the payment without a refund, ledger row or seller notice', async () => {
    const f = await eftOrder()
    const [operation] = await cancelAll(f)

    expect(operation!.refundTransaction).toBeNull()
    expect(operation!.status).toBe('completed')
    expect(operation!.customerRefundAmount.toFixed(2)).toBe('0.00')
    expect(await prisma.refundTransaction.count({ where: { orderId: f.orderId } })).toBe(0)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(0)

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })
    expect(payment.status).toBe('cancelled')
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    expect(order.status).toBe('cancelled_by_customer')
    expect(order.cancellationReason).toBe('customer_requested')
    expect(order.refundedShippingAmount.toFixed(2)).toBe('0.00')
    expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT + 2)

    // Both admin queues stay empty.
    const pendingEft = await createPaymentService({ prisma }).getPendingEftList()
    expect(pendingEft.some((row) => row.orderId === f.orderId)).toBe(false)
    const manualQueue = await createAdminRefundQueryService({ prisma })
      .listManualRequiredForAdmin({ query: f.orderId })
    expect(manualQueue.total).toBe(0)

    // Seller: no outbox row and the order is invisible in every seller query.
    const outbox = await prisma.notificationOutbox.findMany({
      where: { eventKey: { startsWith: `cancellation:${operation!.id}:` } },
    })
    expect(outbox.map((row) => row.eventKey).sort()).toEqual([
      `cancellation:${operation!.id}:customer`,
      `cancellation:${operation!.id}:ops`,
      expect.stringMatching(new RegExp(`^cancellation:${operation!.id}:admin`)),
    ].sort())
    const customerPayload = outbox.find((row) => row.eventKey.endsWith(':customer'))!.payload as {
      data: Record<string, unknown>
    }
    expect(customerPayload.data.paymentNotCollected).toBe(true)
    expect(customerPayload.data).not.toHaveProperty('refundAmount')

    const orders = createOrderRepository(prisma)
    expect(await orders.findByIdForSeller(f.orderId, f.sellerId)).toBeNull()
    const cancelledTab = await orders.listForSellerQueue({
      sellerId: f.sellerId,
      status: ['cancelled_by_customer'],
    })
    expect(cancelledTab.map((row) => row.id)).not.toContain(f.orderId)
    expect(await orders.countForSellerQueue({
      sellerId: f.sellerId,
      status: ['cancelled_by_customer'],
    })).toBe(0)
  })

  it('rejects a partial cancellation and an unfinished card payment', async () => {
    const f = await eftOrder()
    await expect(cancelAll(f, 1)).rejects.toThrow('yalnız siparişin tamamı iptal edilebilir')
    expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).status).toBe('pending')

    const card = await eftOrder({ method: 'card' })
    await expect(cancelAll(card)).rejects.toThrow('Ödemesi tamamlanmamış sipariş iptal edilemez')
  })

  it('replays an idempotent request without queueing a refund', async () => {
    const f = await eftOrder()
    const request = {
      orderId: f.orderId, customerId: f.customerId, reason: 'Vazgeçtim',
      idempotencyKey: `key-${randomUUID()}`, items: [{ orderLineId: f.lineId, quantity: 2 }],
    }
    const service = createQuantityCancellationService({ prisma })
    await service.create(request)
    const [replay] = await service.create(request)
    expect(replay!.refundTransaction).toBeNull()
    expect(await prisma.refundTransaction.count({ where: { orderId: f.orderId } })).toBe(0)
  })

  it('refuses a refund queued directly for an order that collected nothing', async () => {
    const f = await eftOrder()
    await expect(createQuantityRefundService({ prisma }).queue({
      orderId: f.orderId, sellerId: f.sellerId, sourceType: 'cancellation', sourceId: randomUUID(),
      customerAmount: new Decimal(970), grossProductAmount: new Decimal(1000),
      sellerAdjustmentAmount: new Decimal(820), commissionAdjustmentAmount: new Decimal(180),
    })).rejects.toThrow('Tahsil edilmemiş sipariş için iade oluşturulamaz')
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(0)
  })
})

describe('EFT approval and rejection guards', () => {
  it('cannot approve or reject an order the customer already cancelled', async () => {
    const f = await eftOrder()
    // Pre-fix state of production records: the payment stayed pending.
    await cancelAll(f)
    await prisma.payment.update({ where: { id: f.paymentId }, data: { status: 'pending' } })

    const payments = createPaymentService({ prisma })
    await expect(payments.approveEftPayment({ orderId: f.orderId, adminActorId: f.adminId }))
      .rejects.toThrow('havale onayı bekleyen durumda değil')
    await expect(payments.rejectEftPayment({ orderId: f.orderId, adminActorId: f.adminId, reason: 'Dekont yok' }))
      .rejects.toThrow('havale onayı bekleyen durumda değil')

    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    expect(order.status).toBe('cancelled_by_customer')
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(0)
    expect(await prisma.notificationOutbox.count({
      where: { eventKey: { startsWith: `order:${f.orderId}:payment-confirmed` } },
    })).toBe(0)
  })

  it('returns reserved stock when the admin rejects the transfer', async () => {
    const f = await eftOrder()
    await createPaymentService({ prisma }).rejectEftPayment({
      orderId: f.orderId, adminActorId: f.adminId, reason: 'Havale gelmedi',
    })
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId }, include: { lines: true } })
    expect(order.status).toBe('cancelled_due_to_payment_failure')
    expect(order.lines[0]!.cancelledQuantity).toBe(2)
    expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT + 2)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).status).toBe('failed')
    expect(await prisma.refundTransaction.count({ where: { orderId: f.orderId } })).toBe(0)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(0)
    // The rejection e-mail still lists the products (written before the release).
    const mail = await prisma.notificationOutbox.findFirstOrThrow({
      where: { eventKey: `order:${f.orderId}:cancelled:payment_failure` },
    })
    expect(((mail.payload as { data: { items: unknown[] } }).data.items)).toHaveLength(1)
  })

  it('still approves a waiting transfer and posts the seller accrual', async () => {
    const f = await eftOrder()
    await createPaymentService({ prisma }).approveEftPayment({ orderId: f.orderId, adminActorId: f.adminId })
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    expect(order.status).toBe('seller_queue_ready')
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })
    expect(payment.status).toBe('confirmed')
    expect(payment.confirmedAt).not.toBeNull()
    expect(payment.eftConfirmedBy).toBe(f.adminId)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId, type: 'sale' } })).toBe(1)
  })

  it('lets exactly one of a customer cancellation and an admin approval win', async () => {
    const f = await eftOrder()
    const results = await Promise.allSettled([
      cancelAll(f),
      createPaymentService({ prisma }).approveEftPayment({ orderId: f.orderId, adminActorId: f.adminId }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })
    if (order.status === 'cancelled_by_customer') {
      expect(payment.status).toBe('cancelled')
      expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(0)
      expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT + 2)
    } else {
      expect(order.status).toBe('seller_queue_ready')
      expect(payment.status).toBe('confirmed')
      expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT)
    }
  })
})

describe('admin cancellation', () => {
  it('cancels an unpaid EFT order without refund, ledger row or seller notice', async () => {
    const f = await eftOrder()
    await createOrderService({ prisma }).adminCancel({
      orderId: f.orderId, adminActorId: f.adminId, reason: 'Müşteri telefonla iptal istedi',
    })
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    expect(order.status).toBe('cancelled_by_admin')
    expect(order.cancellationReason).toBe('admin_cancelled')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).status).toBe('cancelled')
    expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT + 2)
    expect(await prisma.refundTransaction.count({ where: { orderId: f.orderId } })).toBe(0)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(0)
    expect(await prisma.notificationOutbox.count({ where: { userId: f.sellerUserId } })).toBe(0)
    expect(await prisma.adminAuditLog.count({
      where: { targetId: f.orderId, actionType: 'order_cancelled', actorId: f.adminId },
    })).toBe(1)
  })

  it('refunds a paid order, reverses the seller accrual and tells the seller, without a penalty', async () => {
    const f = await eftOrder({ paid: true })
    await createOrderService({ prisma }).adminCancel({
      orderId: f.orderId, adminActorId: f.adminId, reason: 'Ürün tedarik edilemiyor',
    })
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    expect(order.status).toBe('cancelled_by_admin')
    expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT + 2)
    const refund = await prisma.refundTransaction.findFirstOrThrow({ where: { orderId: f.orderId } })
    expect(refund.status).toBe('manual_required')
    expect(refund.customerAmount.toFixed(2)).toBe('970.00')
    const balance = await prisma.sellerLedgerEntry.aggregate({
      where: { sellerId: f.sellerId }, _sum: { amount: true },
    })
    expect(balance._sum.amount!.toFixed(2)).toBe('0.00')
    expect(await prisma.notificationOutbox.count({ where: { userId: f.sellerUserId } })).toBe(1)
    expect(await prisma.penalty.count({ where: { orderId: f.orderId } })).toBe(0)
  })

  it('refuses once units have been handed to cargo', async () => {
    const f = await eftOrder({ paid: true })
    await prisma.orderLine.update({ where: { id: f.lineId }, data: { shippedQuantity: 1 } })
    await expect(createOrderService({ prisma }).adminCancel({
      orderId: f.orderId, adminActorId: f.adminId, reason: 'Geç kaldı',
    })).rejects.toThrow('Kargoya verilmiş ürün var')
  })

  it('refuses a paid legacy order instead of cancelling it without a refund', async () => {
    const f = await eftOrder({ paid: true })
    await prisma.order.update({ where: { id: f.orderId }, data: { quantityLifecycleVersion: 1 } })
    await expect(createOrderService({ prisma }).adminCancel({
      orderId: f.orderId, adminActorId: f.adminId, reason: 'Eski sipariş',
    })).rejects.toThrow('Eski akıştaki ödenmiş sipariş')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })).status).toBe('seller_queue_ready')
  })
})

describe('repairing refunds created before the fix', () => {
  /** Recreates what production holds for #26050076/77 before the fix. */
  async function preFixState(options: { rejected: boolean }) {
    const f = await eftOrder()
    const [operation] = await cancelAll(f)
    await prisma.payment.update({
      where: { id: f.paymentId },
      data: { status: options.rejected ? 'failed' : 'pending' },
    })
    await prisma.orderCancellation.update({
      where: { id: operation!.id },
      data: {
        status: 'refund_pending', customerRefundAmount: 970, sellerAdjustmentAmount: 820,
        commissionAdjustmentAmount: 180,
      },
    })
    const refund = await prisma.refundTransaction.create({ data: {
      orderId: f.orderId, sellerId: f.sellerId, sourceType: 'cancellation', sourceId: operation!.id,
      customerAmount: 970, grossProductAmount: 1000, sellerAdjustmentAmount: 820,
      commissionAdjustmentAmount: 180, status: 'manual_required',
      failureReason: 'EFT/havale iadesi banka üzerinden manuel tamamlanmalıdır',
      ledgerAppliedAt: new Date(), accountingAppliedAt: new Date(),
      items: { create: [{ kind: 'product', amount: 970, orderLineId: f.lineId, quantity: 2, status: 'manual_required' }] },
    } })
    await prisma.sellerLedgerEntry.create({ data: {
      sellerId: f.sellerId, type: 'refund', amount: -1000, balanceAfter: -1000,
      eventKey: `refund:product:${refund.id}`, referenceType: 'refund_transaction',
      referenceId: refund.id, description: 'İptal edilen ürün bedeli — 1000.00 TRY', visibleToSeller: true,
    } })
    const notification = await prisma.notification.create({ data: {
      userId: f.sellerUserId, type: 'order_canceled', title: 'Siparişinizde adet iptali var', body: 'x',
    } })
    await prisma.notificationDelivery.create({ data: {
      eventKey: `cancellation:${operation!.id}:seller`, userId: f.sellerUserId, type: 'order_canceled',
      channel: 'in_app', recipient: f.sellerUserId, status: 'sent', notificationId: notification.id,
    } })
    if (options.rejected) {
      await prisma.order.update({
        where: { id: f.orderId }, data: { status: 'cancelled_due_to_payment_failure' },
      })
      await prisma.orderStatusHistory.create({ data: {
        orderId: f.orderId, toStatus: 'cancelled_due_to_payment_failure', actorId: f.adminId,
        reason: 'Havale reddedildi: iptal edilmiş',
      } })
    }
    return { ...f, refundId: refund.id, notificationId: notification.id, cancellationId: operation!.id }
  }

  it.each([
    { rejected: false, payment: 'cancelled' },
    { rejected: true, payment: 'failed' },
  ])('voids the refund, nets the ledger to zero and hides it from the seller: %j', async ({ rejected, payment }) => {
    const f = await preFixState({ rejected })
    const targets = (await findUnpaidCancellationRefunds(prisma)).map((row) => row.id)
    expect(targets).toContain(f.refundId)

    const before = await prisma.$transaction([
      prisma.sellerLedgerEntry.count(), prisma.refundTransaction.count(), prisma.payment.count(),
    ])
    const plan = await describeRepair(prisma, f.refundId)
    expect(plan.ledgerToReverse).toHaveLength(1)
    expect(plan.restoreStatusTo).toBe(rejected ? 'cancelled_by_customer' : null)
    // Dry-run is read-only.
    expect(await prisma.$transaction([
      prisma.sellerLedgerEntry.count(), prisma.refundTransaction.count(), prisma.payment.count(),
    ])).toEqual(before)
    expect((await prisma.refundTransaction.findUniqueOrThrow({ where: { id: f.refundId } })).status)
      .toBe('manual_required')

    const result = await applyRepair(prisma, f.refundId, {
      actorId: f.adminId, reason: 'Ödemesi alınmamış sipariş iptali düzeltmesi',
    })
    expect(result).toMatchObject({ skipped: false, reversed: 1, netLedger: '0.00' })

    const refund = await prisma.refundTransaction.findUniqueOrThrow({
      where: { id: f.refundId }, include: { items: true },
    })
    expect(refund.status).toBe('voided')
    expect(refund.items.every((item) => item.status === 'voided')).toBe(true)
    const entries = await prisma.sellerLedgerEntry.findMany({ where: { sellerId: f.sellerId } })
    expect(entries.reduce((sum, entry) => sum.add(entry.amount), new Decimal(0)).toFixed(2)).toBe('0.00')
    expect(entries.some((entry) => entry.visibleToSeller)).toBe(false)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).status).toBe(payment)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: f.orderId } })
    expect(order.status).toBe('cancelled_by_customer')
    const cancellation = await prisma.orderCancellation.findUniqueOrThrow({ where: { id: f.cancellationId } })
    expect(cancellation.status).toBe('completed')
    expect(cancellation.customerRefundAmount.toFixed(2)).toBe('0.00')
    expect(await prisma.notification.count({ where: { id: f.notificationId } })).toBe(0)
    expect(await prisma.notificationDelivery.count({
      where: { eventKey: `cancellation:${f.cancellationId}:seller` },
    })).toBe(1)
    expect(await stockOf(f.productId)).toBe(STOCK_AFTER_CHECKOUT + 2)

    const manualQueue = await createAdminRefundQueryService({ prisma })
      .listManualRequiredForAdmin({ query: f.orderId })
    expect(manualQueue.total).toBe(0)
    const pendingEft = await createPaymentService({ prisma }).getPendingEftList()
    expect(pendingEft.some((row) => row.orderId === f.orderId)).toBe(false)
    expect((await reconcileFinance(prisma, f.sellerId)).findings).toEqual([])
    expect(await prisma.adminAuditLog.count({
      where: { targetId: f.refundId, actionType: 'manual_ledger_adjustment' },
    })).toBe(1)

    // Second run finds nothing and changes nothing.
    expect((await findUnpaidCancellationRefunds(prisma)).map((row) => row.id)).not.toContain(f.refundId)
    expect(await applyRepair(prisma, f.refundId, { actorId: f.adminId, reason: 'tekrar çalıştırma' }))
      .toMatchObject({ skipped: true })
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerId } })).toBe(2)
  })

  it('never touches a refund whose order collected its payment', async () => {
    const f = await eftOrder({ paid: true })
    await cancelAll(f)
    const refund = await prisma.refundTransaction.findFirstOrThrow({ where: { orderId: f.orderId } })
    expect((await findUnpaidCancellationRefunds(prisma)).map((row) => row.id)).not.toContain(refund.id)
    await expect(applyRepair(prisma, refund.id, { actorId: f.adminId, reason: 'yanlış hedef deneme' }))
      .rejects.toThrow('onarım kapsamında değil')
  })
})
