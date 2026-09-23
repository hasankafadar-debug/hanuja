/**
 * Admin operation notifications against a real PostgreSQL database.
 *
 * Every trigger path is exercised on its own — including the three dispute
 * sources, both return flows and both support flows — because they are separate
 * code paths that each have to write exactly one operations row without
 * disturbing the existing per-admin in-app notifications.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

// The real function returns a promise; the post-commit dispatch chains `.catch` on it.
vi.mock('../../api/jobs/refund-processing.job', () => ({
  enqueueRefundProcessing: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../api/lib/prisma', () => ({
  get prisma() {
    return prisma
  },
}))

const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error(
    'NOTIFICATION_TEST_DATABASE_URL must point to disposable local hanuja_notification_test',
  )
const url = new URL(testUrl)
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/hanuja_notification_test'
)
  throw new Error('Refusing non-local notification test database')
const schema = `admin_ops_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

import { createQuantityCancellationService } from '../../api/services/quantity-cancellation.service'
import { createQuantityReturnService } from '../../api/services/quantity-return.service'
import { createReturnService } from '../../api/services/return.service'
import { createDisputeService } from '../../api/services/dispute.service'
import { createSupportTicketService } from '../../api/services/support-ticket.service'
import { createCustomerSupportTicketService } from '../../api/services/customer-support-ticket.service'
import { sweepFulfillmentRiskNotifications } from '../../api/services/fulfillment-risk-notification.service'
import { createAdminNotificationRecipientService } from '../../api/services/admin-notification.service'
import { createCheckoutService } from '../../api/services/checkout.service'

beforeAll(async () => {
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
  if (!/^admin_ops_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

afterEach(async () => {
  await prisma.notificationOutbox.deleteMany({})
})

interface Fixture {
  orderId: string
  orderLineId: string
  sellerId: string
  sellerUserId: string
  customerId: string
  adminIds: string[]
  productId: string
}

async function seedOrder(
  options: {
    status?: string
    quantityLifecycleVersion?: number
    adminCount?: number
    /** Units already shipped; cancellation only applies to unshipped ones. */
    shippedQuantity?: number
  } = {},
): Promise<Fixture> {
  const suffix = randomUUID()
  const customer = await prisma.user.create({
    data: { email: `c-${suffix}@example.test`, name: 'Ayşe', role: 'customer' },
  })
  const sellerUser = await prisma.user.create({
    data: { email: `s-${suffix}@example.test`, name: 'Satıcı', role: 'seller' },
  })
  const adminIds: string[] = []
  for (let index = 0; index < (options.adminCount ?? 2); index += 1) {
    const admin = await prisma.user.create({
      data: {
        email: `a-${index}-${suffix}@example.test`,
        name: `Admin ${index}`,
        role: 'admin',
      },
    })
    adminIds.push(admin.id)
  }
  const seller = await prisma.seller.create({
    data: {
      userId: sellerUser.id,
      slug: `atelier-${suffix.slice(0, 8)}`,
      displayName: 'Atelier Noa',
      status: 'active',
    },
  })
  const category = await prisma.category.create({
    data: { slug: `kategori-${suffix.slice(0, 8)}`, name: 'Mobilya' },
  })
  const product = await prisma.product.create({
    data: {
      sellerId: seller.id,
      categoryId: category.id,
      slug: `urun-${suffix.slice(0, 8)}`,
      name: 'Gea Berjer',
      price: new Decimal('100.00'),
      stockQuantity: 5,
    },
  })
  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      fullName: 'Ayşe Yılmaz',
      phone: '5551112233',
      addressLine1: 'Atölye Sk. 3',
      district: 'Kadıköy',
      city: 'İstanbul',
      postalCode: '34000',
    },
  })
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      addressId: address.id,
      status: (options.status ?? 'delivery_confirmed') as never,
      grossAmount: new Decimal('200.00'),
      totalAmount: new Decimal('200.00'),
      deliveryConfirmedAt: new Date(),
      ...(options.quantityLifecycleVersion
        ? { quantityLifecycleVersion: options.quantityLifecycleVersion }
        : {}),
      lines: {
        create: {
          productId: product.id,
          sellerId: seller.id,
          productName: 'Gea Berjer',
          quantity: 2,
          unitPrice: new Decimal('100.00'),
          totalPrice: new Decimal('200.00'),
          customerPaidProductAmount: new Decimal('200.00'),
          netPayoutAmount: new Decimal('200.00'),
          shippedQuantity: options.shippedQuantity ?? 2,
          deliveryConfirmedAt: new Date(),
        },
      },
    },
    include: { lines: true },
  })
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: 'card',
      provider: 'iyzico',
      status: 'confirmed',
      amount: new Decimal('200.00'),
      providerPaymentId: `prov-${suffix}`,
      confirmedAt: new Date(),
    },
  })
  await prisma.paymentProviderItem.create({
    data: {
      paymentId: payment.id,
      orderLineId: order.lines[0]!.id,
      kind: 'product',
      providerItemId: `line:${order.lines[0]!.id}`,
      providerTransactionId: `tx-${suffix}`,
      amount: new Decimal('200.00'),
    },
  })
  return {
    orderId: order.id,
    orderLineId: order.lines[0]!.id,
    sellerId: seller.id,
    sellerUserId: sellerUser.id,
    customerId: customer.id,
    adminIds,
    productId: product.id,
  }
}

function opsRows() {
  return prisma.notificationOutbox.findMany({
    where: { userId: 'ops' },
    orderBy: { createdAt: 'asc' },
  })
}

function payloadOf(row: { payload: unknown }) {
  return row.payload as {
    type: string
    emailTo: string
    eventKey: string
    data: Record<string, unknown>
  }
}

describe('admin operation notifications', () => {
  it('writes one ops row for a quantity cancellation without multiplying admin copies', async () => {
    const fixture = await seedOrder({
      status: 'payment_confirmed',
      quantityLifecycleVersion: 2,
      adminCount: 3,
      shippedQuantity: 0,
    })

    await createQuantityCancellationService({ prisma }).create({
      orderId: fixture.orderId,
      customerId: fixture.customerId,
      reason: 'Vazgeçtim',
      actorRole: 'customer',
      items: [{ orderLineId: fixture.orderLineId, quantity: 1 }],
    })

    const ops = await opsRows()
    expect(ops).toHaveLength(1)
    expect(payloadOf(ops[0]!).type).toBe('admin_order_cancellation')
    expect(payloadOf(ops[0]!).emailTo).toBe('admin@hanuja.com.tr')

    // Three admins still get their in-app copy; only one e-mail row exists.
    const adminInApp = await prisma.notificationOutbox.findMany({
      where: { userId: { in: fixture.adminIds } },
    })
    expect(adminInApp).toHaveLength(3)
    for (const row of adminInApp) {
      expect((row.payload as { emailTo?: string }).emailTo).toBeUndefined()
    }
  })

  it('is idempotent: repeating the same event writes no second row', async () => {
    const fixture = await seedOrder({
      status: 'payment_confirmed',
      quantityLifecycleVersion: 2,
      shippedQuantity: 0,
    })
    const service = createQuantityCancellationService({ prisma })
    const params = {
      orderId: fixture.orderId,
      customerId: fixture.customerId,
      reason: 'Vazgeçtim',
      idempotencyKey: 'req-1',
      actorRole: 'customer' as const,
      items: [{ orderLineId: fixture.orderLineId, quantity: 1 }],
    }
    await service.create(params)
    await service.create(params)

    expect(await opsRows()).toHaveLength(1)
  })

  it('covers both return flows separately', async () => {
    const v2 = await seedOrder({ quantityLifecycleVersion: 2 })
    await createQuantityReturnService({ prisma }).openRequest({
      orderId: v2.orderId,
      customerId: v2.customerId,
      reason: 'Ürün hasarlı',
      items: [{ orderLineId: v2.orderLineId, quantity: 1 }],
    })
    let ops = await opsRows()
    expect(ops).toHaveLength(1)
    expect(payloadOf(ops[0]!).type).toBe('admin_return_requested')
    expect(payloadOf(ops[0]!).data.flowLabel).toBe('Adet bazlı iade')
    await prisma.notificationOutbox.deleteMany({})

    const legacy = await seedOrder()
    await createReturnService({ prisma }).openRequest({
      orderId: legacy.orderId,
      customerId: legacy.customerId,
      reason: 'Ürün hasarlı',
    })
    ops = await opsRows()
    expect(ops).toHaveLength(1)
    expect(payloadOf(ops[0]!).type).toBe('admin_return_requested')
    expect(payloadOf(ops[0]!).data.flowLabel).toBe('Sipariş bazlı iade (eski akış)')
  })

  it('covers all three dispute sources separately', async () => {
    // (1) customer opens a dispute directly
    const direct = await seedOrder()
    const dispute = await createDisputeService({ prisma }).openDispute({
      orderId: direct.orderId,
      customerId: direct.customerId,
      reason: 'Ürün eksik geldi',
    })
    let ops = await opsRows()
    expect(ops).toHaveLength(1)
    expect(payloadOf(ops[0]!).eventKey).toBe(`dispute:${dispute.id}:ops`)
    expect(payloadOf(ops[0]!).data.sourceLabel).toBe('Müşteri uyuşmazlık açtı')
    await prisma.notificationOutbox.deleteMany({})

    // (2) legacy seller rejection of a returned item
    const legacy = await seedOrder({ status: 'return_in_transit' })
    const legacyReturn = await prisma.returnRequest.create({
      data: {
        orderId: legacy.orderId,
        customerId: legacy.customerId,
        sellerId: legacy.sellerId,
        reason: 'Hasarlı',
        status: 'in_transit',
        isWithinWindow: true,
      },
    })
    await createReturnService({ prisma }).rejectReceiptBySeller({
      returnRequestId: legacyReturn.id,
      sellerId: legacy.sellerId,
      reason: 'Ürün kullanılmış',
      description: 'Kutu açılmış',
    })
    ops = await opsRows()
    expect(
      ops.filter((row) => payloadOf(row).type === 'admin_dispute_opened'),
    ).toHaveLength(1)
    await prisma.notificationOutbox.deleteMany({})

    // (3) quantity flow: seller rejects part of the delivery
    const v2 = await seedOrder({
      status: 'return_in_transit',
      quantityLifecycleVersion: 2,
    })
    const v2Return = await prisma.returnRequest.create({
      data: {
        orderId: v2.orderId,
        customerId: v2.customerId,
        sellerId: v2.sellerId,
        reason: 'Hasarlı',
        status: 'in_transit',
        isWithinWindow: true,
        items: {
          create: {
            orderLineId: v2.orderLineId,
            requestedQuantity: 2,
            requestedCustomerAmount: new Decimal('200.00'),
            requestedGrossProductAmount: new Decimal('200.00'),
            requestedSellerAdjustmentAmount: new Decimal('200.00'),
          },
        },
      },
      include: { items: true },
    })
    await prisma.orderLine.update({
      where: { id: v2.orderLineId },
      data: { returnClaimedQuantity: 2 },
    })
    await createQuantityReturnService({ prisma }).decideReceipt({
      returnRequestId: v2Return.id,
      sellerId: v2.sellerId,
      decisions: [
        {
          returnRequestItemId: v2Return.items[0]!.id,
          acceptedQuantity: 0,
          rejectedQuantity: 2,
          rejectionReason: 'Ürün kullanılmış',
        },
      ],
    })
    ops = await opsRows()
    expect(
      ops.filter((row) => payloadOf(row).type === 'admin_dispute_opened'),
    ).toHaveLength(1)
  })

  it('covers seller and customer support tickets separately, with their own types and links', async () => {
    const fixture = await seedOrder()

    await createSupportTicketService({ prisma }).createForSeller({
      sellerId: fixture.sellerId,
      authorId: fixture.sellerUserId,
      subject: 'Kargo etiketi basılmıyor',
      body: 'Etiket indirilemiyor, yardım eder misiniz?',
    })
    let ops = await opsRows()
    expect(ops).toHaveLength(1)
    expect(payloadOf(ops[0]!).type).toBe('admin_support_new_ticket')
    expect(String(payloadOf(ops[0]!).data.adminUrl)).toContain('/destek/')
    await prisma.notificationOutbox.deleteMany({})

    await createCustomerSupportTicketService({ prisma }).createForCustomer({
      customerId: fixture.customerId,
      orderId: fixture.orderId,
      category: 'shipping_delay',
      subject: 'Siparişim gelmedi',
      body: 'Kargo hareket etmiyor, bilgi alabilir miyim?',
    })
    ops = await opsRows()
    expect(ops).toHaveLength(1)
    expect(payloadOf(ops[0]!).type).toBe('admin_customer_support_new')
    expect(String(payloadOf(ops[0]!).data.adminUrl)).toContain('/musteri-destek/')
    expect(payloadOf(ops[0]!).data.categoryLabel).toBe('Kargo gecikmesi')
  })

  it('notifies a fulfillment risk once per level and again after it recurs', async () => {
    const fixture = await seedOrder({ status: 'payment_confirmed' })
    const asOf = new Date()
    await prisma.fulfillmentRisk.create({
      data: {
        orderId: fixture.orderId,
        orderLineId: fixture.orderLineId,
        sellerId: fixture.sellerId,
        status: 'warning',
        deadlineAt: new Date(asOf.getTime() + 2 * 86_400_000),
      },
    })

    expect(await sweepFulfillmentRiskNotifications(prisma, asOf)).toMatchObject({
      notified: 1,
    })
    // A repeat run at the same level writes nothing.
    expect(await sweepFulfillmentRiskNotifications(prisma, asOf)).toMatchObject({
      notified: 0,
      unchanged: 1,
    })
    expect(await opsRows()).toHaveLength(1)

    // Level change → second e-mail.
    await prisma.fulfillmentRisk.updateMany({
      where: { orderId: fixture.orderId },
      data: { status: 'breached' },
    })
    await sweepFulfillmentRiskNotifications(prisma, asOf)
    expect(await opsRows()).toHaveLength(2)

    // Resolved: recorded, no e-mail — this is what makes a recurrence notifiable.
    await prisma.fulfillmentRisk.updateMany({
      where: { orderId: fixture.orderId },
      data: { status: 'resolved' },
    })
    expect(await sweepFulfillmentRiskNotifications(prisma, asOf)).toMatchObject({
      resolved: 1,
      notified: 0,
    })
    expect(await opsRows()).toHaveLength(2)

    // Recurrence at the same level as before is a new event.
    await prisma.fulfillmentRisk.updateMany({
      where: { orderId: fixture.orderId },
      data: { status: 'breached' },
    })
    await sweepFulfillmentRiskNotifications(prisma, asOf)
    const ops = await opsRows()
    expect(ops).toHaveLength(3)
    expect(payloadOf(ops[2]!).eventKey).toBe(
      `fulfillment-risk:${fixture.orderId}:${fixture.sellerId}:3:breached`,
    )
  })

  it('writes one row and one transition when two sweeps run concurrently', async () => {
    const fixture = await seedOrder({ status: 'payment_confirmed' })
    const asOf = new Date()
    await prisma.fulfillmentRisk.create({
      data: {
        orderId: fixture.orderId,
        orderLineId: fixture.orderLineId,
        sellerId: fixture.sellerId,
        status: 'breached',
        deadlineAt: new Date(asOf.getTime() - 5 * 86_400_000),
      },
    })

    // Create branch: both workers race to insert the state row.
    await Promise.all([
      sweepFulfillmentRiskNotifications(prisma, asOf),
      sweepFulfillmentRiskNotifications(prisma, asOf),
    ])
    expect(await opsRows()).toHaveLength(1)
    let states = await prisma.fulfillmentRiskNotificationState.findMany({
      where: { orderId: fixture.orderId },
    })
    expect(states).toHaveLength(1)
    expect(states[0]!.transitionSeq).toBe(1)

    // Update branch: both workers see the same level change.
    await prisma.fulfillmentRisk.updateMany({
      where: { orderId: fixture.orderId },
      data: { status: 'warning' },
    })
    await Promise.all([
      sweepFulfillmentRiskNotifications(prisma, asOf),
      sweepFulfillmentRiskNotifications(prisma, asOf),
    ])
    expect(await opsRows()).toHaveLength(2)
    states = await prisma.fulfillmentRiskNotificationState.findMany({
      where: { orderId: fixture.orderId },
    })
    expect(states[0]!.transitionSeq).toBe(2)
  })

  it('sends new events to a changed address while queued rows keep the old one', async () => {
    const fixture = await seedOrder({ quantityLifecycleVersion: 2 })
    const admin = await prisma.user.create({
      data: { email: `settings-${randomUUID()}@example.test`, role: 'admin' },
    })
    const recipients = createAdminNotificationRecipientService({ prisma })

    await createQuantityReturnService({ prisma }).openRequest({
      orderId: fixture.orderId,
      customerId: fixture.customerId,
      reason: 'Ürün hasarlı',
      items: [{ orderLineId: fixture.orderLineId, quantity: 1 }],
    })
    const queued = await opsRows()
    expect(payloadOf(queued[0]!).emailTo).toBe('admin@hanuja.com.tr')

    await recipients.update({
      actorId: admin.id,
      entries: [{ event: 'return_requested', email: 'Iade@Hanuja.com.tr' }],
    })

    const second = await seedOrder({ quantityLifecycleVersion: 2 })
    await createQuantityReturnService({ prisma }).openRequest({
      orderId: second.orderId,
      customerId: second.customerId,
      reason: 'Ürün hasarlı',
      items: [{ orderLineId: second.orderLineId, quantity: 1 }],
    })

    const rows = await opsRows()
    expect(rows).toHaveLength(2)
    // The address is resolved when the event is recorded, not when it is sent.
    expect(payloadOf(rows[0]!).emailTo).toBe('admin@hanuja.com.tr')
    expect(payloadOf(rows[1]!).emailTo).toBe('iade@hanuja.com.tr')

    const audit = await prisma.adminAuditLog.findMany({
      where: { actionType: 'notification_recipient_changed' },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]!.targetId).toBe('return_requested')
  })

  it('tells the operations mailbox that an EFT order is waiting for approval', async () => {
    const suffix = randomUUID()
    const customer = await prisma.user.create({
      data: { email: `eft-${suffix}@example.test`, name: 'Ayşe', role: 'customer' },
    })
    const sellerUser = await prisma.user.create({
      data: { email: `eft-s-${suffix}@example.test`, role: 'seller' },
    })
    const seller = await prisma.seller.create({
      data: {
        userId: sellerUser.id,
        slug: `eft-atelier-${suffix.slice(0, 8)}`,
        displayName: 'Atelier Noa',
        status: 'active',
      },
    })
    const category = await prisma.category.create({
      data: { slug: `eft-kategori-${suffix.slice(0, 8)}`, name: 'Mobilya' },
    })
    const product = await prisma.product.create({
      data: {
        sellerId: seller.id,
        categoryId: category.id,
        slug: `eft-urun-${suffix.slice(0, 8)}`,
        name: 'Gea Berjer',
        price: new Decimal('100.00'),
        stockQuantity: 5,
        status: 'published',
      },
    })
    const address = await prisma.address.create({
      data: {
        userId: customer.id,
        fullName: 'Ayşe Yılmaz',
        phone: '5551112233',
        addressLine1: 'Atölye Sk. 3',
        district: 'Kadıköy',
        city: 'İstanbul',
        postalCode: '34000',
      },
    })
    await prisma.cart.create({
      data: {
        userId: customer.id,
        items: {
          create: { productId: product.id, quantity: 1, unitPrice: new Decimal('100.00') },
        },
      },
    })

    const order = await createCheckoutService({ prisma }).createOrder({
      userId: customer.id,
      addressId: address.id,
      paymentMethod: 'eft',
      legalAcceptance: {
        acceptedAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        sessionId: null,
      },
    })

    const ops = await opsRows()
    expect(ops).toHaveLength(1)
    const payload = payloadOf(ops[0]!)
    expect(payload.type).toBe('admin_bank_transfer_pending')
    expect(payload.eventKey).toBe(`order:${order.order.id}:eft-pending`)
    expect(String(payload.data.adminUrl)).toContain('/odemeler')
  })

  it('rolls the ops row back with the business transaction', async () => {
    const fixture = await seedOrder({ quantityLifecycleVersion: 2 })

    await expect(
      createQuantityReturnService({ prisma }).openRequest({
        orderId: fixture.orderId,
        customerId: fixture.customerId,
        reason: 'Ürün hasarlı',
        // More units than were shipped: the transaction must fail as a whole.
        items: [{ orderLineId: fixture.orderLineId, quantity: 99 }],
      }),
    ).rejects.toThrow()

    expect(await opsRows()).toHaveLength(0)
    expect(
      await prisma.returnRequest.count({ where: { orderId: fixture.orderId } }),
    ).toBe(0)
  })
})

/**
 * The delivery lifecycle with a null `userId`. Nothing here is assumed to keep
 * working: the operations screen, the retry path and the provider webhook are
 * each exercised against a real ops delivery row.
 */
describe('ops delivery lifecycle without a user account', () => {
  const recipient = 'ops@hanuja.com.tr'

  // Each test gets its own event: delivery rows are not cleaned between tests,
  // and (recipient, channel, eventKey) is unique.
  async function seedOpsDelivery(
    overrides: Partial<{ status: string; transportStatus: string }> = {},
  ) {
    const eventKey = `dispute:${randomUUID()}:ops`
    const admin = await prisma.user.create({
      data: { email: `ops-admin-${randomUUID()}@example.test`, role: 'admin' },
    })
    const delivery = await prisma.notificationDelivery.create({
      data: {
        eventKey,
        userId: null,
        type: 'admin_dispute_opened',
        channel: 'email',
        recipient,
        status: (overrides.status ?? 'failed') as never,
        transportStatus: overrides.transportStatus ?? 'unknown',
        providerMessageId: `provider-${randomUUID()}`,
        payload: {
          eventKey,
          userId: 'ops',
          type: 'admin_dispute_opened',
          title: 'Uyuşmazlık',
          body: 'gövde',
          emailTo: recipient,
          data: {
            orderNumber: '26050042',
            adminUrl: 'https://admin.hanuja.com.tr/uyusmazliklar/d-1',
          },
        },
      },
    })
    return { admin, delivery, eventKey }
  }

  it('lists ops deliveries on the admin e-mail screen', async () => {
    const { admin, eventKey } = await seedOpsDelivery()
    const { createNotificationOperationsService } = await import(
      '../../api/services/notification-operations.service'
    )
    const page = await createNotificationOperationsService(prisma).list(admin.id)
    const row = page.deliveries.find((item) => item.eventKey === eventKey)
    expect(row).toBeDefined()
    expect(row!.recipient).toBe(recipient)
    expect(row!.canRetry).toBe(true)
  })

  it('re-queues a failed ops delivery to the same mailbox', async () => {
    const { admin, delivery } = await seedOpsDelivery()
    const { createNotificationOperationsService } = await import(
      '../../api/services/notification-operations.service'
    )
    await createNotificationOperationsService(prisma).retry(
      admin.id,
      delivery.id,
      'SMTP ayarı düzeltildi',
      'delivery',
    )
    const rows = await opsRows()
    expect(rows).toHaveLength(1)
    expect(payloadOf(rows[0]!).emailTo).toBe(recipient)
    expect(rows[0]!.status).toBe('pending')
  })

  it('refuses to re-queue while an ops delivery is in an uncertain SMTP state', async () => {
    // Regression: matching only on `userId` never found ops deliveries, so this
    // guard silently stopped protecting them.
    const { admin, eventKey } = await seedOpsDelivery({
      status: 'failed',
      transportStatus: 'uncertain',
    })
    const outbox = await prisma.notificationOutbox.create({
      data: {
        eventKey,
        userId: 'ops',
        type: 'admin_dispute_opened',
        lane: 'transactional',
        status: 'failed',
        payload: { eventKey, userId: 'ops', type: 'admin_dispute_opened', emailTo: recipient },
      },
    })
    const { createNotificationOperationsService } = await import(
      '../../api/services/notification-operations.service'
    )
    await expect(
      createNotificationOperationsService(prisma).retry(
        admin.id,
        outbox.id,
        'Tekrar denensin',
        'outbox',
      ),
    ).rejects.toThrow('belirsiz')
  })

  it('applies a provider webhook result to an ops delivery', async () => {
    const { delivery } = await seedOpsDelivery({ status: 'sent' })
    await prisma.emailProviderEvent.create({
      data: {
        id: `evt-${randomUUID()}`,
        providerMessageId: delivery.providerMessageId!,
        type: 'email.delivered',
        occurredAt: new Date(),
      },
    })
    const { reconcileEmailProviderEvents } = await import(
      '../../api/services/email-provider-event.service'
    )
    await reconcileEmailProviderEvents(prisma, delivery.id)
    const updated = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    })
    expect(updated.transportStatus).toBe('delivered')
  })
})
