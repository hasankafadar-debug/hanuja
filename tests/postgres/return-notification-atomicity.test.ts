/**
 * Atomicity of the legacy return flow against a real PostgreSQL database.
 *
 * Proves what the unit tests cannot: that the business status, the status
 * history, the persisted RefundTransaction and the notification outbox row
 * commit or roll back together, that a missed provider dispatch is recoverable
 * through the existing worker/admin paths without paying twice, and that
 * concurrent repeats do not double-write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

const enqueueRefundProcessing = vi.hoisted(() => vi.fn())
vi.mock('../../api/jobs/refund-processing.job', () => ({ enqueueRefundProcessing }))
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
const schema = `return_atomicity_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

import { createReturnService } from '../../api/services/return.service'
import { createRefundExecutionService } from '../../api/services/refund-execution.service'
import { createQuantityRefundService } from '../../api/services/quantity-refund.service'
import { createQuantityReturnService } from '../../api/services/quantity-return.service'

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
  if (!/^return_atomicity_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

interface Fixture {
  orderId: string
  returnRequestId: string
  sellerId: string
  customerId: string
  paymentId: string
  orderLineId: string
}

/** One delivered, card-paid single-seller order with a return in the given status. */
async function seedReturn(
  options: { status?: 'requested' | 'approved' | 'in_transit'; paymentMethod?: 'card' | 'eft' } = {},
): Promise<Fixture> {
  const suffix = randomUUID()
  const returnStatus = options.status ?? 'in_transit'
  const orderStatus =
    returnStatus === 'in_transit'
      ? 'return_in_transit'
      : returnStatus === 'approved'
        ? 'return_approved'
        : 'return_requested'
  const customer = await prisma.user.create({
    data: { email: `customer-${suffix}@example.test`, name: 'Ayşe', role: 'customer' },
  })
  const sellerUser = await prisma.user.create({
    data: { email: `seller-${suffix}@example.test`, name: 'Satıcı', role: 'seller' },
  })
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
      status: orderStatus,
      grossAmount: new Decimal('200.00'),
      totalAmount: new Decimal('200.00'),
      deliveryConfirmedAt: new Date(),
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
          deliveryConfirmedAt: new Date(),
        },
      },
    },
    include: { lines: true },
  })
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      method: options.paymentMethod ?? 'card',
      provider: options.paymentMethod === 'eft' ? 'manual_eft' : 'iyzico',
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
  const returnRequest = await prisma.returnRequest.create({
    data: {
      orderId: order.id,
      customerId: customer.id,
      sellerId: seller.id,
      reason: 'Ürün hasarlı geldi',
      status: returnStatus,
      isWithinWindow: true,
    },
  })
  return {
    orderId: order.id,
    returnRequestId: returnRequest.id,
    sellerId: seller.id,
    customerId: customer.id,
    paymentId: payment.id,
    orderLineId: order.lines[0]!.id,
  }
}

/**
 * Quantity-lifecycle (v2) variant: the refund items map onto payment provider
 * items, so the refund stays `pending` and is completed by the worker job —
 * the legacy path above always needs an admin instead.
 */
async function seedQuantityReturn() {
  const fixture = await seedReturn()
  await prisma.order.update({
    where: { id: fixture.orderId },
    data: { quantityLifecycleVersion: 2 },
  })
  await prisma.orderLine.update({
    where: { id: fixture.orderLineId },
    data: { shippedQuantity: 2, returnClaimedQuantity: 2 },
  })
  const item = await prisma.returnRequestItem.create({
    data: {
      returnRequestId: fixture.returnRequestId,
      orderLineId: fixture.orderLineId,
      requestedQuantity: 2,
      requestedCustomerAmount: new Decimal('200.00'),
      requestedGrossProductAmount: new Decimal('200.00'),
      requestedSellerAdjustmentAmount: new Decimal('200.00'),
    },
  })
  return { ...fixture, returnRequestItemId: item.id }
}

function service(client: PrismaClient = prisma) {
  return createReturnService({ prisma: client })
}

/** A client whose notification-outbox write fails, to force a rollback. */
function clientWithFailingOutbox(): PrismaClient {
  return prisma.$extends({
    query: {
      notificationOutbox: {
        async upsert() {
          throw new Error('OUTBOX_DOWN')
        },
      },
    },
  }) as unknown as PrismaClient
}

/** A client whose refund write fails, to force a rollback of the receipt decision. */
function clientWithFailingRefund(): PrismaClient {
  return prisma.$extends({
    query: {
      refundTransaction: {
        async create() {
          throw new Error('REFUND_DOWN')
        },
      },
    },
  }) as unknown as PrismaClient
}

describe('legacy return flow atomicity against PostgreSQL', () => {
  it('rolls back every covered flow when the notification cannot be written', async () => {
    // 1. seller provides cargo info
    const cargo = await seedReturn({ status: 'requested' })
    await expect(
      service(clientWithFailingOutbox()).provideSellerCargoInfo({
        returnRequestId: cargo.returnRequestId,
        sellerId: cargo.sellerId,
        address: 'Atölye Sk. 3',
        carrier: 'Yurtiçi Kargo',
      }),
    ).rejects.toThrow('OUTBOX_DOWN')
    const afterCargo = await prisma.returnRequest.findUniqueOrThrow({
      where: { id: cargo.returnRequestId },
    })
    expect(afterCargo.status).toBe('requested')
    expect(afterCargo.sellerReturnAddress).toBeNull()
    expect(await prisma.orderStatusHistory.count({ where: { orderId: cargo.orderId } })).toBe(0)
    expect(await prisma.notificationOutbox.count()).toBe(0)
    // The operator can retry because the status guard still accepts the call.
    await service().provideSellerCargoInfo({
      returnRequestId: cargo.returnRequestId,
      sellerId: cargo.sellerId,
      address: 'Atölye Sk. 3',
      carrier: 'Yurtiçi Kargo',
    })
    expect(
      (await prisma.returnRequest.findUniqueOrThrow({ where: { id: cargo.returnRequestId } })).status,
    ).toBe('approved')
    expect(
      await prisma.notificationOutbox.count({ where: { userId: cargo.customerId } }),
    ).toBe(1)

    // 2. customer ships the item back
    const shipment = await seedReturn({ status: 'approved' })
    await expect(
      service(clientWithFailingOutbox()).submitCustomerShipment({
        returnRequestId: shipment.returnRequestId,
        customerId: shipment.customerId,
        carrier: 'Yurtiçi Kargo',
        trackingNumber: 'YK1',
      }),
    ).rejects.toThrow('OUTBOX_DOWN')
    expect(
      (await prisma.returnRequest.findUniqueOrThrow({ where: { id: shipment.returnRequestId } }))
        .status,
    ).toBe('approved')

    // 3. seller confirms receipt (refund + notification + status)
    const receipt = await seedReturn()
    await expect(
      service(clientWithFailingOutbox()).confirmReceiptBySeller({
        returnRequestId: receipt.returnRequestId,
        sellerId: receipt.sellerId,
      }),
    ).rejects.toThrow('OUTBOX_DOWN')
    expect(
      (await prisma.returnRequest.findUniqueOrThrow({ where: { id: receipt.returnRequestId } }))
        .status,
    ).toBe('in_transit')
    expect(await prisma.refundTransaction.count({ where: { orderId: receipt.orderId } })).toBe(0)

    // 4. seller rejects receipt (dispute must not survive either)
    const rejection = await seedReturn()
    await expect(
      service(clientWithFailingOutbox()).rejectReceiptBySeller({
        returnRequestId: rejection.returnRequestId,
        sellerId: rejection.sellerId,
        reason: 'Ürün kullanılmış',
      }),
    ).rejects.toThrow('OUTBOX_DOWN')
    expect(
      (await prisma.returnRequest.findUniqueOrThrow({ where: { id: rejection.returnRequestId } }))
        .status,
    ).toBe('in_transit')
    expect(await prisma.dispute.count({ where: { orderId: rejection.orderId } })).toBe(0)

    // 5. admin review
    const review = await seedReturn({ status: 'requested' })
    await expect(
      service(clientWithFailingOutbox()).reviewRequest({
        returnRequestId: review.returnRequestId,
        adminActorId: 'admin-1',
        decision: 'approved',
      }),
    ).rejects.toThrow('OUTBOX_DOWN')
    const afterReview = await prisma.returnRequest.findUniqueOrThrow({
      where: { id: review.returnRequestId },
    })
    expect(afterReview.status).toBe('requested')
    expect(afterReview.reviewedBy).toBeNull()
    expect(await prisma.adminAuditLog.count({ where: { targetId: review.returnRequestId } })).toBe(0)

    // 6. admin marks the item received
    const adminRefund = await seedReturn()
    await expect(
      service(clientWithFailingOutbox()).markItemReceived({
        returnRequestId: adminRefund.returnRequestId,
        adminActorId: 'admin-1',
        refundAmount: new Decimal('200.00'),
      }),
    ).rejects.toThrow('OUTBOX_DOWN')
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: adminRefund.orderId } })).status,
    ).toBe('return_in_transit')
    expect(await prisma.refundTransaction.count({ where: { orderId: adminRefund.orderId } })).toBe(0)

    // 7. customer opens a return
    const opening = await seedReturn({ status: 'requested' })
    await prisma.returnRequest.delete({ where: { id: opening.returnRequestId } })
    await prisma.order.update({
      where: { id: opening.orderId },
      data: { status: 'delivery_confirmed' },
    })
    await expect(
      service(clientWithFailingOutbox()).openRequest({
        orderId: opening.orderId,
        customerId: opening.customerId,
        reason: 'Beğenmedim',
      }),
    ).rejects.toThrow('OUTBOX_DOWN')
    expect(await prisma.returnRequest.count({ where: { orderId: opening.orderId } })).toBe(0)
  })

  it('rolls the receipt decision back completely when the refund record cannot be created', async () => {
    const fixture = await seedReturn()
    await expect(
      service(clientWithFailingRefund()).confirmReceiptBySeller({
        returnRequestId: fixture.returnRequestId,
        sellerId: fixture.sellerId,
      }),
    ).rejects.toThrow('REFUND_DOWN')

    const rr = await prisma.returnRequest.findUniqueOrThrow({
      where: { id: fixture.returnRequestId },
    })
    expect(rr.status).toBe('in_transit')
    expect(rr.sellerReceivedAt).toBeNull()
    expect(await prisma.refundTransaction.count({ where: { orderId: fixture.orderId } })).toBe(0)
    expect(
      await prisma.notificationOutbox.count({ where: { userId: fixture.customerId } }),
    ).toBe(0)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.orderId } })).status).toBe(
      'return_in_transit',
    )
  })

  it('keeps the refund record and the notification when the provider dispatch never runs, and the worker path completes it once', async () => {
    enqueueRefundProcessing.mockClear()
    enqueueRefundProcessing.mockRejectedValueOnce(new Error('REDIS_DOWN'))
    const fixture = await seedQuantityReturn()

    await createQuantityReturnService({ prisma }).decideReceipt({
      returnRequestId: fixture.returnRequestId,
      sellerId: fixture.sellerId,
      decisions: [
        {
          returnRequestItemId: fixture.returnRequestItemId,
          acceptedQuantity: 2,
          rejectedQuantity: 0,
        },
      ],
    })

    // Committed work survives the failed dispatch.
    const refunds = await prisma.refundTransaction.findMany({
      where: { orderId: fixture.orderId },
      include: { items: true },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0]!.status).toBe('pending')
    expect(enqueueRefundProcessing).toHaveBeenCalledTimes(1)
    const outbox = await prisma.notificationOutbox.findMany({
      where: { userId: fixture.customerId },
    })
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.status).toBe('pending')
    expect((outbox[0]!.payload as { data: { refundOutcome: string } }).data.refundOutcome).toBe(
      'processing',
    )

    // Recovery: the worker entry point processes the same record, once.
    const providerRefund = vi.fn(async () => ({ providerReference: 'prov-ref-1' }))
    const execution = createRefundExecutionService({
      prisma,
      processorFactory: (() => ({ refund: providerRefund })) as never,
    })
    await execution.process(refunds[0]!.id)
    await execution.process(refunds[0]!.id)

    expect(providerRefund).toHaveBeenCalledTimes(1)
    expect(await prisma.refundTransaction.count({ where: { orderId: fixture.orderId } })).toBe(1)
    const settled = await prisma.refundTransaction.findUniqueOrThrow({
      where: { id: refunds[0]!.id },
    })
    expect(settled.status).toBe('completed')
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })
    expect(payment.refundedAmount.toFixed(2)).toBe('200.00')
  })

  it('marks a legacy card refund for manual review instead of claiming an automatic payment', async () => {
    enqueueRefundProcessing.mockClear()
    const fixture = await seedReturn()

    await service().confirmReceiptBySeller({
      returnRequestId: fixture.returnRequestId,
      sellerId: fixture.sellerId,
    })

    // Legacy refunds carry no provider item mapping, so they always need an admin.
    const refund = await prisma.refundTransaction.findFirstOrThrow({
      where: { orderId: fixture.orderId },
    })
    expect(refund.status).toBe('manual_required')
    expect(enqueueRefundProcessing).not.toHaveBeenCalled()
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: { userId: fixture.customerId },
    })
    expect((outbox.payload as { data: { refundOutcome: string } }).data.refundOutcome).toBe(
      'manual_review',
    )
  })

  it('lets an admin complete a manual-review refund through the admin service without paying twice', async () => {
    enqueueRefundProcessing.mockClear()
    // EFT refunds always land in manual_required — the customer copy says so.
    const fixture = await seedReturn({ paymentMethod: 'eft' })

    await service().confirmReceiptBySeller({
      returnRequestId: fixture.returnRequestId,
      sellerId: fixture.sellerId,
    })

    const refund = await prisma.refundTransaction.findFirstOrThrow({
      where: { orderId: fixture.orderId },
    })
    expect(refund.status).toBe('manual_required')
    expect(enqueueRefundProcessing).not.toHaveBeenCalled()
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: { userId: fixture.customerId },
    })
    expect((outbox.payload as { data: { refundOutcome: string } }).data.refundOutcome).toBe(
      'manual_review',
    )

    const admin = await prisma.user.create({
      data: { email: `admin-${randomUUID()}@example.test`, role: 'admin' },
    })
    const quantityRefunds = createQuantityRefundService({ prisma })
    await quantityRefunds.complete({
      refundTransactionId: refund.id,
      orderId: fixture.orderId,
      actorId: admin.id,
      providerReference: 'BANKA-REF-1',
      expectedOutstandingAmount: refund.customerAmount.toFixed(2),
    })
    // A repeat of the same admin action must not move money again.
    await quantityRefunds
      .complete({
        refundTransactionId: refund.id,
        orderId: fixture.orderId,
        actorId: admin.id,
        providerReference: 'BANKA-REF-1',
        expectedOutstandingAmount: refund.customerAmount.toFixed(2),
      })
      .catch(() => null)

    expect(await prisma.refundTransaction.count({ where: { orderId: fixture.orderId } })).toBe(1)
    const settled = await prisma.refundTransaction.findUniqueOrThrow({ where: { id: refund.id } })
    expect(settled.status).toBe('completed')
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })
    expect(payment.refundedAmount.toFixed(2)).toBe('200.00')
  })

  it('serialises concurrent repeats of the same seller decision', async () => {
    const fixture = await seedReturn()
    const results = await Promise.allSettled([
      service().rejectReceiptBySeller({
        returnRequestId: fixture.returnRequestId,
        sellerId: fixture.sellerId,
        reason: 'Ürün kullanılmış',
      }),
      service().rejectReceiptBySeller({
        returnRequestId: fixture.returnRequestId,
        sellerId: fixture.sellerId,
        reason: 'Ürün kullanılmış',
      }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.dispute.count({ where: { orderId: fixture.orderId } })).toBe(1)
    expect(
      await prisma.orderStatusHistory.count({
        where: { orderId: fixture.orderId, toStatus: 'return_rejected' },
      }),
    ).toBe(1)
    expect(
      await prisma.notificationOutbox.count({ where: { userId: fixture.customerId } }),
    ).toBe(1)
  })

  it('does not let the first admin approval swallow the later refund decision', async () => {
    enqueueRefundProcessing.mockClear()
    const fixture = await seedReturn({ status: 'requested' })

    await service().reviewRequest({
      returnRequestId: fixture.returnRequestId,
      adminActorId: 'admin-1',
      decision: 'approved',
      reviewNote: 'Kargo bilgisi iletilecek',
    })
    await service().markItemReceived({
      returnRequestId: fixture.returnRequestId,
      adminActorId: 'admin-1',
      refundAmount: new Decimal('200.00'),
    })

    const rows = await prisma.notificationOutbox.findMany({
      where: { userId: fixture.customerId },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows).toHaveLength(2)
    const payloads = rows.map((row) => row.payload as { eventKey: string; data: Record<string, unknown> })
    expect(payloads[0]!.eventKey).toBe(`return:${fixture.returnRequestId}:customer:review:approved`)
    expect(payloads[0]!.data.refundOutcome).toBe('awaiting_return')
    expect(payloads[0]!.data.refundAmount).toBeUndefined()
    expect(payloads[1]!.eventKey).toBe(`return:${fixture.returnRequestId}:customer:admin-refund`)
    // Legacy refunds have no provider item mapping, so they wait for an admin.
    expect(payloads[1]!.data.refundOutcome).toBe('manual_review')
    expect(payloads[1]!.data.refundAmount).toBe('200 TL')
  })

  it('authorises a legacy return without sellerId through the seller order lines and refuses another seller', async () => {
    const fixture = await seedReturn({ status: 'requested' })
    await prisma.returnRequest.update({
      where: { id: fixture.returnRequestId },
      data: { sellerId: null },
    })
    const outsiderUser = await prisma.user.create({
      data: { email: `outsider-${randomUUID()}@example.test`, role: 'seller' },
    })
    const outsider = await prisma.seller.create({
      data: {
        userId: outsiderUser.id,
        slug: `outsider-${randomUUID().slice(0, 8)}`,
        displayName: 'Başka Mağaza',
        status: 'active',
      },
    })

    await expect(
      service().provideSellerCargoInfo({
        returnRequestId: fixture.returnRequestId,
        sellerId: outsider.id,
        address: 'Yanlış adres',
        carrier: 'Aras',
      }),
    ).rejects.toThrow()
    expect(
      (await prisma.returnRequest.findUniqueOrThrow({ where: { id: fixture.returnRequestId } }))
        .status,
    ).toBe('requested')
    expect(
      await prisma.notificationOutbox.count({ where: { userId: fixture.customerId } }),
    ).toBe(0)

    // The seller that owns the order lines is still authorised.
    await service().provideSellerCargoInfo({
      returnRequestId: fixture.returnRequestId,
      sellerId: fixture.sellerId,
      address: 'Atölye Sk. 3',
      carrier: 'Yurtiçi Kargo',
    })
    expect(
      (await prisma.returnRequest.findUniqueOrThrow({ where: { id: fixture.returnRequestId } }))
        .status,
    ).toBe('approved')
  })
})

export type { Prisma }
