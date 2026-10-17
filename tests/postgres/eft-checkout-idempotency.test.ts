/**
 * Havale/EFT siparişi: çift gönderim tek sipariş açar; ödenmeden kapanan siparişin kupon
 * kullanımı tam bir kez geri verilir. Gerçek PostgreSQL (kilitler, tekil indeks, migration).
 *
 * Kurallar: docs/07-operations/order-lifecycle.md §3.A "Havale/EFT siparişi tek açılır" ve §7.1–7.2,
 * docs/06-engineering/api-contracts.md "EFT order creation".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(async () => undefined),
}))
vi.mock('../../api/jobs/refund-processing.job', () => ({
  enqueueRefundProcessing: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/refund-notification.service', () => ({
  enqueueCustomerRefundCompletedNotification: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/product-stock-sync', () => ({
  wakeStockSearchProjection: vi.fn(async () => undefined),
}))

import { createCheckoutService } from '../../api/services/checkout.service'
import { createQuantityCancellationService } from '../../api/services/quantity-cancellation.service'
import { createPaymentService } from '../../api/services/payment.service'
import { createOrderService } from '../../api/services/order.service'

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
  // migrate deploy (not db push): the new orders unique index is created by its migration.
  execFileSync(
    process.execPath,
    [
      resolve('../db/node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      resolve('../db/schema/schema.prisma'),
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  )
  await prisma.$connect()
})

afterAll(async () => {
  // Only the random schema created above is removed; never reset a supplied database.
  if (!/^finance_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

const ACCEPTANCE = {
  acceptedAt: new Date(),
  ipAddress: '203.0.113.5',
  userAgent: 'vitest',
  sessionId: null,
}
const STOCK = 5
/** Other customers' uses: a double give-back would show up as one below this. */
const COUPON_USES_BEFORE = 5

const newKey = () => `eft-${randomUUID()}`

/** A customer with a filled cart, a platform coupon on it and two addresses. */
async function checkoutFixture() {
  const tag = randomUUID().slice(0, 12)
  const admin = await prisma.user.create({
    data: { email: `admin-${tag}@example.test`, role: 'admin' },
  })
  const customer = await prisma.user.create({
    data: { email: `customer-${tag}@example.test`, name: 'Ayşe Yılmaz', emailVerified: true },
  })
  const address = (line: string) =>
    prisma.address.create({
      data: {
        userId: customer.id,
        fullName: 'Ayşe Yılmaz',
        phone: '05321234567',
        addressLine1: line,
        district: 'Kadıköy',
        city: 'İstanbul',
        postalCode: '34710',
        invoiceType: 'individual',
        tcNumber: '10000000146',
      },
    })
  const home = await address('Moda Cad. No 1')
  const office = await address('Bahariye Cad. No 9')
  const sellerUser = await prisma.user.create({ data: { email: `seller-${tag}@example.test` } })
  const seller = await prisma.seller.create({
    data: { userId: sellerUser.id, slug: `seller-${tag}`, displayName: 'Atölye Test', status: 'active' },
  })
  const category = await prisma.category.create({ data: { slug: `sehpa-${tag}`, name: 'Sehpa' } })
  const product = (name: string, price: string) =>
    prisma.product.create({
      data: {
        sellerId: seller.id,
        categoryId: category.id,
        name,
        slug: `${name.toLowerCase().replaceAll(' ', '-')}-${tag}`,
        price,
        stockQuantity: STOCK,
        status: 'published',
      },
    })
  const sehpa = await product('Mese Sehpa', '600.00')
  const raf = await product('Ceviz Raf', '350.00')
  const coupon = await prisma.coupon.create({
    data: {
      code: `HOS-${tag}`,
      discountType: 'fixed_amount',
      discountValue: 50,
      usageCount: COUPON_USES_BEFORE,
    },
  })
  await prisma.cart.create({
    data: {
      userId: customer.id,
      couponCode: coupon.code,
      items: { create: [{ productId: sehpa.id, quantity: 2, unitPrice: '600.00' }] },
    },
  })
  return { admin, customer, home, office, seller, sehpa, raf, coupon }
}

type Fixture = Awaited<ReturnType<typeof checkoutFixture>>

function orderParams(f: Fixture, key: string, overrides: { addressId?: string } = {}) {
  return {
    userId: f.customer.id,
    addressId: overrides.addressId ?? f.home.id,
    paymentMethod: 'eft' as const,
    idempotencyKey: key,
    legalAcceptance: ACCEPTANCE,
  }
}

async function placeEftOrder(f: Fixture, key = newKey()) {
  return createCheckoutService({ prisma }).createOrder(orderParams(f, key))
}

async function stockOf(productId: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity
}

async function couponState(couponId: string) {
  const coupon = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } })
  return {
    usageCount: coupon.usageCount,
    usages: await prisma.couponUsage.count({ where: { couponId } }),
  }
}

async function orderPlacedMails(orderId: string) {
  return prisma.notificationOutbox.count({
    where: { eventKey: `order:${orderId}:created:customer` },
  })
}

describe('EFT order submission is idempotent', () => {
  it('opens one order when the same request arrives four times at once', async () => {
    const f = await checkoutFixture()
    const key = newKey()

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        createCheckoutService({ prisma }).createOrder(orderParams(f, key)),
      ),
    )

    const orderIds = new Set(results.map((result) => result.order.id))
    expect(orderIds.size).toBe(1)
    expect(results.filter((result) => !result.replayed)).toHaveLength(1)
    const [orderId] = [...orderIds]
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1)
    expect(await stockOf(f.sehpa.id)).toBe(STOCK - 2)
    expect(await couponState(f.coupon.id)).toEqual({
      usageCount: COUPON_USES_BEFORE + 1,
      usages: 1,
    })
    expect(await orderPlacedMails(orderId!)).toBe(1)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe('bank_transfer_waiting')
    expect(order.checkoutRequestKey).toBe(key)
    // Every answer carries what the order page needs, the repeats included.
    for (const result of results) {
      expect(result.payment.method).toBe('eft')
      expect(result.lines).toHaveLength(1)
      expect(result.bankTransferInstructions).toBeTruthy()
    }
  })

  it('answers a repeat after the first request finished with the same order', async () => {
    const f = await checkoutFixture()
    const key = newKey()
    const first = await placeEftOrder(f, key)
    expect(first.replayed).toBe(false)
    // The first request emptied the cart; a repeat must not fail on it.
    expect(await prisma.cartItem.count({ where: { cart: { userId: f.customer.id } } })).toBe(0)

    const repeat = await placeEftOrder(f, key)

    expect(repeat.replayed).toBe(true)
    expect(repeat.order.id).toBe(first.order.id)
    expect(repeat.payment.id).toBe(first.payment.id)
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
    expect(await stockOf(f.sehpa.id)).toBe(STOCK - 2)
    expect(await couponState(f.coupon.id)).toEqual({
      usageCount: COUPON_USES_BEFORE + 1,
      usages: 1,
    })
    expect(await orderPlacedMails(first.order.id)).toBe(1)
  })

  it('refuses the same key once the cart holds something else', async () => {
    const f = await checkoutFixture()
    const key = newKey()
    const first = await placeEftOrder(f, key)
    const cart = await prisma.cart.findUniqueOrThrow({ where: { userId: f.customer.id } })
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: f.raf.id, quantity: 1, unitPrice: '350.00' },
    })

    await expect(placeEftOrder(f, key)).rejects.toMatchObject({
      code: 'CHECKOUT_REQUEST_REUSED',
      statusCode: 409,
      details: { orderId: first.order.id },
    })

    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
    expect(await stockOf(f.raf.id)).toBe(STOCK)
    // The new cart is untouched; a new request key orders it (the one-per-customer coupon
    // is already used by the first order, so it is taken off first).
    await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } })
    const second = await placeEftOrder(f)
    expect(second.replayed).toBe(false)
    expect(second.order.id).not.toBe(first.order.id)
    expect(second.lines.map((line) => line.productId)).toEqual([f.raf.id])
  })

  it('refuses the same key with another delivery address', async () => {
    const f = await checkoutFixture()
    const key = newKey()
    const first = await placeEftOrder(f, key)

    await expect(
      createCheckoutService({ prisma }).createOrder(orderParams(f, key, { addressId: f.office.id })),
    ).rejects.toMatchObject({ code: 'CHECKOUT_REQUEST_REUSED', details: { orderId: first.order.id } })
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
  })

  it('lets only one of two concurrent requests with one key and different inputs win', async () => {
    const f = await checkoutFixture()
    const key = newKey()

    const results = await Promise.allSettled([
      createCheckoutService({ prisma }).createOrder(orderParams(f, key)),
      createCheckoutService({ prisma }).createOrder(orderParams(f, key, { addressId: f.office.id })),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toBeDefined()
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: 'CHECKOUT_REQUEST_REUSED',
    })
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
    expect(await stockOf(f.sehpa.id)).toBe(STOCK - 2)
  })

  it('keeps keys per customer: the same key string orders for two customers', async () => {
    const a = await checkoutFixture()
    const b = await checkoutFixture()
    const key = newKey()

    const [first, second] = await Promise.all([placeEftOrder(a, key), placeEftOrder(b, key)])

    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(false)
    expect(first.order.customerId).toBe(a.customer.id)
    expect(second.order.customerId).toBe(b.customer.id)
  })

  it('rejects a malformed key before reading the cart', async () => {
    const f = await checkoutFixture()
    await expect(placeEftOrder(f, 'kisa')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(0)
  })
})

describe('an unpaid EFT order gives its coupon use back exactly once', () => {
  async function unpaidOrderWithCoupon() {
    const f = await checkoutFixture()
    const placed = await placeEftOrder(f)
    expect(await couponState(f.coupon.id)).toEqual({
      usageCount: COUPON_USES_BEFORE + 1,
      usages: 1,
    })
    return { f, orderId: placed.order.id, lineId: placed.lines[0]!.id }
  }

  const customerCancel = (
    ctx: Awaited<ReturnType<typeof unpaidOrderWithCoupon>>,
    idempotencyKey?: string,
  ) =>
    createQuantityCancellationService({ prisma }).create({
      orderId: ctx.orderId,
      customerId: ctx.f.customer.id,
      reason: 'Yanlışlıkla sipariş verdim',
      ...(idempotencyKey ? { idempotencyKey } : {}),
      items: [{ orderLineId: ctx.lineId, quantity: 2 }],
    })

  const released = { usageCount: COUPON_USES_BEFORE, usages: 0 }

  it('when the customer cancels before the transfer is approved', async () => {
    const ctx = await unpaidOrderWithCoupon()
    const requestKey = `cancel-${randomUUID()}`

    await customerCancel(ctx, requestKey)
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)

    // The same request replayed, then a fresh one: neither gives the use back again.
    await customerCancel(ctx, requestKey)
    await expect(customerCancel(ctx)).rejects.toThrow()
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ctx.orderId } })).status).toBe(
      'cancelled_by_customer',
    )
  })

  it('when the admin rejects the transfer', async () => {
    const ctx = await unpaidOrderWithCoupon()
    const payments = createPaymentService({ prisma })

    await payments.rejectEftPayment({
      orderId: ctx.orderId,
      adminActorId: ctx.f.admin.id,
      reason: 'Dekont gelmedi',
    })
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)

    await expect(
      payments.rejectEftPayment({
        orderId: ctx.orderId,
        adminActorId: ctx.f.admin.id,
        reason: 'Dekont gelmedi',
      }),
    ).rejects.toThrow()
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)
    expect(await stockOf(ctx.f.sehpa.id)).toBe(STOCK)
  })

  it('when the admin cancels the unpaid order', async () => {
    const ctx = await unpaidOrderWithCoupon()
    const orders = createOrderService({ prisma })

    await orders.adminCancel({
      orderId: ctx.orderId,
      adminActorId: ctx.f.admin.id,
      reason: 'Müşteri telefonla iptal istedi',
    })
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)

    await expect(
      orders.adminCancel({
        orderId: ctx.orderId,
        adminActorId: ctx.f.admin.id,
        reason: 'Müşteri telefonla iptal istedi',
      }),
    ).rejects.toThrow()
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ctx.orderId } })).status).toBe(
      'cancelled_by_admin',
    )
  })

  it('when the admin cancels an unpaid legacy order', async () => {
    const ctx = await unpaidOrderWithCoupon()
    await prisma.order.update({
      where: { id: ctx.orderId },
      data: { quantityLifecycleVersion: 1 },
    })
    const orders = createOrderService({ prisma })

    await orders.adminCancel({
      orderId: ctx.orderId,
      adminActorId: ctx.f.admin.id,
      reason: 'Eski sipariş iptali',
    })
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)

    await expect(
      orders.adminCancel({
        orderId: ctx.orderId,
        adminActorId: ctx.f.admin.id,
        reason: 'Eski sipariş iptali',
      }),
    ).rejects.toThrow()
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)
  })

  it('once when a customer cancellation and an admin rejection race', async () => {
    const ctx = await unpaidOrderWithCoupon()

    const results = await Promise.allSettled([
      customerCancel(ctx),
      createPaymentService({ prisma }).rejectEftPayment({
        orderId: ctx.orderId,
        adminActorId: ctx.f.admin.id,
        reason: 'Dekont gelmedi',
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await couponState(ctx.f.coupon.id)).toEqual(released)
    expect(await stockOf(ctx.f.sehpa.id)).toBe(STOCK)
  })

  it('but a paid order keeps its coupon use when the admin cancels it', async () => {
    const ctx = await unpaidOrderWithCoupon()
    await createPaymentService({ prisma }).approveEftPayment({
      orderId: ctx.orderId,
      adminActorId: ctx.f.admin.id,
      evidenceNote: 'Dekont kontrol edildi',
    })

    await createOrderService({ prisma }).adminCancel({
      orderId: ctx.orderId,
      adminActorId: ctx.f.admin.id,
      reason: 'Ürün tedarik edilemiyor',
    })

    // Unchanged policy: a collected order's coupon stays used; the refund covers the money.
    expect(await couponState(ctx.f.coupon.id)).toEqual({
      usageCount: COUPON_USES_BEFORE + 1,
      usages: 1,
    })
    expect(await prisma.refundTransaction.count({ where: { orderId: ctx.orderId } })).toBe(1)
  })
})
