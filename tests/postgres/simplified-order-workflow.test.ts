import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createQuantityRefundService } from '../../api/services/quantity-refund.service'
import { createOrderDocumentService } from '../../api/services/order-document.service'
import { createSellerReturnInvoiceService } from '../../api/services/seller-return-invoice.service'
import { createPrivateDocumentStorage } from '../../api/lib/private-document-storage'
import { getReportingDateKey } from '../../api/lib/reporting-time'
import { createDisputeService } from '../../api/services/dispute.service'
import { createReturnRequestRepository } from '../../api/repositories/return-request.repository'
import { createQuantityCancellationService } from '../../api/services/quantity-cancellation.service'
import { createPenaltyService } from '../../api/services/penalty.service'
import { createOrderRepository } from '../../api/repositories/order.repository'
import { createOrderService } from '../../api/services/order.service'
import { createQuantityReturnService } from '../../api/services/quantity-return.service'

const url = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL ?? '')
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/hanuja_notification_test'
)
  throw Error('Disposable local notification DB required')
const schema = 'workflow_test_' + randomUUID().replaceAll('-', '')
url.searchParams.set('schema', schema)
const db = new PrismaClient({ datasourceUrl: url.toString() })
let storage: ReturnType<typeof createPrivateDocumentStorage>
const PDF = Buffer.from('%PDF-1.4\nLOCAL WORKFLOW TEST\n%%EOF')
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
  storage = createPrivateDocumentStorage({
    root: await mkdtemp(join(tmpdir(), 'hanuja-workflow-docs-')),
    encryptionKey: Buffer.alloc(32, 23),
  })
  process.env.INVOICE_MANAGEMENT_ENABLED = 'true'
})
afterAll(async () => {
  if (!/^workflow_test_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe schema')
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
  await db.$disconnect()
})
async function seed() {
  const id = randomUUID()
  const customer = await db.user.create({
    data: { email: `c-${id}@example.test`, name: 'Müşteri' },
  })
  const designer = await db.user.create({
    data: { email: `s-${id}@example.test`, role: 'seller' },
  })
  const admin = await db.user.create({
    data: { email: `a-${id}@example.test`, role: 'admin' },
  })
  const seller = await db.seller.create({
    data: {
      userId: designer.id,
      slug: 's-' + id,
      displayName: 'Test Tasarımcı',
      status: 'active',
    },
  })
  const product = await db.product.create({
    data: {
      sellerId: seller.id,
      slug: 'p-' + id,
      name: 'Test Ürün',
      price: 1200,
      stockQuantity: 5,
    },
  })
  const order = await db.order.create({
    data: {
      customerId: customer.id,
      status: 'delivery_confirmed',
      quantityLifecycleVersion: 2,
      grossAmount: 1200,
      totalAmount: 1200,
      paymentConfirmedAt: new Date(),
      lines: {
        create: {
          productId: product.id,
          sellerId: seller.id,
          productName: 'Test Ürün',
          quantity: 1,
          shippedQuantity: 1,
          unitPrice: 1200,
          totalPrice: 1200,
          customerPaidProductAmount: 1200,
          commissionRate: 0.2,
          commissionAmount: 288,
          taxRate: 0.2,
          deliveredAt: new Date(),
        },
      },
      payments: {
        create: {
          method: 'eft',
          provider: 'manual_eft',
          status: 'confirmed',
          amount: 1200,
          confirmedAt: new Date(),
        },
      },
    },
    include: { lines: true },
  })
  const rr = await db.returnRequest.create({
    data: {
      orderId: order.id,
      customerId: customer.id,
      sellerId: seller.id,
      reason: 'Müşterinin özel açıklaması',
      description: 'Müşteri serbest metni',
      status: 'received',
      isWithinWindow: true,
    },
  })
  return { customer, designer, admin, seller, order, rr }
}
describe('simplified order workflow on real PostgreSQL', () => {
  it('allows the invoice for the settled accepted quantity after the other quantity is finally rejected', async () => {
    const f = await seed()
    const line = f.order.lines[0]!
    await db.order.update({
      where: { id: f.order.id },
      data: { grossAmount: 2400, totalAmount: 2400 },
    })
    await db.payment.updateMany({ where: { orderId: f.order.id }, data: { amount: 2400 } })
    await db.orderLine.update({
      where: { id: line.id },
      data: {
        quantity: 2,
        shippedQuantity: 2,
        totalPrice: 2400,
        customerPaidProductAmount: 2400,
        commissionAmount: 576,
      },
    })
    await db.returnRequestItem.create({
      data: {
        returnRequestId: f.rr.id,
        orderLineId: line.id,
        requestedQuantity: 2,
        acceptedQuantity: 1,
        rejectedQuantity: 1,
        customerRefundAmount: 1200,
        grossProductAmount: 1200,
        sellerAdjustmentAmount: 912,
        commissionAdjustmentAmount: 288,
      },
    })
    const dispute = await db.dispute.create({
      data: {
        orderId: f.order.id,
        openedById: f.designer.id,
        reason: 'Diğer adet reddedildi',
        status: 'resolved_for_seller',
        resolvedBy: f.admin.id,
        resolvedAt: new Date(),
        resolution: 'Reddedilen adet müşteriye geri gönderilecek.',
      },
    })
    await db.returnRequest.update({
      where: { id: f.rr.id },
      data: {
        status: 'rejected',
        disputeId: dispute.id,
        sellerRejectedAt: new Date(Date.now() - 1000),
        reviewedAt: new Date(),
        reviewedBy: f.admin.id,
      },
    })
    const documents = createOrderDocumentService({ prisma: db, storage })
    const purchase = await documents.uploadInvoiceForSeller({
      orderId: f.order.id,
      sellerId: f.seller.id,
      actorId: f.designer.id,
      fileName: 'purchase.pdf',
      mimeType: 'application/pdf',
      body: PDF,
      sizeBytes: PDF.length,
    })
    // Türkiye calendar day, as the admin enters it (the UTC date lags before 03:00).
    const day = getReportingDateKey(new Date())
    await documents.reviewSellerInvoice({
      orderId: f.order.id,
      sellerId: f.seller.id,
      actorId: f.admin.id,
      decision: 'approve',
      expectedRevision: purchase.revision,
      invoiceNumber: 'TEST-MIXED-PURCHASE',
      invoiceDate: day,
    })
    const refunds = createQuantityRefundService({ prisma: db })
    const refund = await refunds.queue({
      orderId: f.order.id,
      sellerId: f.seller.id,
      sourceType: 'return_request',
      sourceId: f.rr.id,
      customerAmount: new Decimal(1200),
      grossProductAmount: new Decimal(1200),
      sellerAdjustmentAmount: new Decimal(912),
      commissionAdjustmentAmount: new Decimal(288),
      items: [{ orderLineId: line.id, quantity: 1, amount: new Decimal(1200) }],
    })
    const invoices = createSellerReturnInvoiceService({ prisma: db, storage })
    const identity = { returnRequestId: f.rr.id, sellerId: f.seller.id, actorId: f.admin.id }
    expect((await invoices.getForAdmin(identity)).ready).toBe(false)
    await refunds.complete({
      refundTransactionId: refund.id,
      orderId: f.order.id,
      actorId: f.admin.id,
      providerReference: 'TEST-MIXED-EFT',
      expectedOutstandingAmount: '1200.00',
    })
    expect((await db.returnRequest.findUniqueOrThrow({ where: { id: f.rr.id } })).status).toBe(
      'rejected',
    )
    expect((await invoices.getForAdmin(identity)).ready).toBe(true)
    const ledger = await db.sellerLedgerEntry.findMany({ where: { sellerId: f.seller.id } })
    await invoices.upload({
      ...identity,
      invoiceNumber: 'TEST-MIXED-RETURN',
      invoiceDate: day,
      fileName: 'return.pdf',
      mimeType: 'application/pdf',
      body: PDF,
    })
    expect(await db.sellerLedgerEntry.findMany({ where: { sellerId: f.seller.id } })).toEqual(
      ledger,
    )
  })
  it('keeps evidence attachment and the return claim atomic', async () => {
    const f = await seed()
    const asset = await db.mediaAsset.create({
      data: {
        type: 'product_image',
        url: '',
        key: 'returns/local/test.png',
        folder: 'returns',
        uploadedBy: f.customer.id,
        status: 'ready',
      },
    })
    const broken = db.$extends({
      query: {
        mediaAsset: {
          async updateMany() {
            throw Error('SIMULATED_ATTACHMENT_FAILURE')
          },
        },
      },
    })
    const params = {
      orderId: f.order.id,
      customerId: f.customer.id,
      reason: 'Yerel görsel atomiklik testi',
      idempotencyKey: randomUUID(),
      evidenceAssetIds: [asset.id],
      items: [{ orderLineId: f.order.lines[0]!.id, quantity: 1 }],
    }
    await expect(
      createQuantityReturnService({ prisma: broken as unknown as PrismaClient }).openRequest(
        params,
      ),
    ).rejects.toThrow('SIMULATED_ATTACHMENT_FAILURE')
    expect(
      (await db.orderLine.findUniqueOrThrow({ where: { id: f.order.lines[0]!.id } }))
        .returnClaimedQuantity,
    ).toBe(0)
    expect(await db.returnRequest.count({ where: { requestKey: params.idempotencyKey } })).toBe(0)
    const service = createQuantityReturnService({ prisma: db })
    const requests = await service.openRequest(params)
    await service.openRequest(params)
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).returnRequestId,
    ).toBe(requests[0]!.id)
    expect(await db.returnRequest.count({ where: { requestKey: params.idempotencyKey } })).toBe(1)
  })
  it('allows an admin to cancel only unshipped quantities after another designer ships and replays safely', async () => {
    const f = await seed()
    const second = await seed()
    const line = f.order.lines[0]!
    await db.order.update({
      where: { id: f.order.id },
      data: { status: 'shipped', grossAmount: 3600, totalAmount: 3600 },
    })
    await db.payment.updateMany({ where: { orderId: f.order.id }, data: { amount: 3600 } })
    await db.orderLine.update({
      where: { id: line.id },
      data: {
        quantity: 2,
        shippedQuantity: 0,
        deliveredAt: null,
        totalPrice: 2400,
        customerPaidProductAmount: 2400,
        commissionAmount: 576,
      },
    })
    const shipped = await db.orderLine.create({
      data: {
        orderId: f.order.id,
        productId: second.order.lines[0]!.productId,
        sellerId: second.seller.id,
        productName: 'Kargodaki ürün',
        quantity: 1,
        shippedQuantity: 1,
        unitPrice: 1200,
        totalPrice: 1200,
        customerPaidProductAmount: 1200,
        commissionRate: 0.2,
        commissionAmount: 288,
        taxRate: 0.2,
      },
    })
    const params = {
      orderId: f.order.id,
      adminActorId: f.admin.id,
      reason: 'Telefonla müşteri talebi teyit edildi.',
      idempotencyKey: randomUUID(),
      items: [{ orderLineId: line.id, quantity: 1 }],
    }
    const service = createOrderService({ prisma: db })
    await service.adminCancel(params)
    await service.adminCancel(params)
    expect(
      (await db.orderLine.findUniqueOrThrow({ where: { id: line.id } })).cancelledQuantity,
    ).toBe(1)
    expect(
      (await db.orderLine.findUniqueOrThrow({ where: { id: shipped.id } })).cancelledQuantity,
    ).toBe(0)
    expect(await db.refundTransaction.count({ where: { orderId: f.order.id } })).toBe(1)
    await expect(
      service.adminCancel({
        ...params,
        idempotencyKey: randomUUID(),
        items: [{ orderLineId: shipped.id, quantity: 1 }],
      }),
    ).rejects.toThrow('iptal edilebilir')
    expect(await db.refundTransaction.count({ where: { orderId: f.order.id } })).toBe(1)
  })
  it('rolls back paid cancellation and stock release when the refund cannot be persisted', async () => {
    const f = await seed()
    const line = f.order.lines[0]!
    await db.order.update({ where: { id: f.order.id }, data: { status: 'seller_queue_ready' } })
    await db.orderLine.update({
      where: { id: line.id },
      data: { shippedQuantity: 0, deliveredAt: null },
    })
    const stock = (await db.product.findUniqueOrThrow({ where: { id: line.productId } }))
      .stockQuantity
    const broken = db.$extends({
      query: {
        refundTransaction: {
          async create() {
            throw Error('SIMULATED_REFUND_WRITE_FAILURE')
          },
        },
      },
    })
    const params = {
      orderId: f.order.id,
      customerId: f.customer.id,
      reason: 'Yerel iptal testi',
      idempotencyKey: 'cancel-' + f.order.id,
      items: [{ orderLineId: line.id, quantity: 1 }],
    }
    await expect(
      createQuantityCancellationService({ prisma: broken as unknown as PrismaClient }).create(
        params,
      ),
    ).rejects.toThrow('SIMULATED_REFUND_WRITE_FAILURE')
    expect(
      (await db.orderLine.findUniqueOrThrow({ where: { id: line.id } })).cancelledQuantity,
    ).toBe(0)
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: line.productId } })).stockQuantity,
    ).toBe(stock)
    expect(await db.orderCancellation.count({ where: { orderId: f.order.id } })).toBe(0)
    expect(
      await db.notificationOutbox.count({
        where: { payload: { path: ['orderId'], equals: f.order.id } },
      }),
    ).toBe(0)
    const service = createQuantityCancellationService({ prisma: db })
    await service.create(params)
    await service.create(params)
    expect(await db.refundTransaction.count({ where: { orderId: f.order.id } })).toBe(1)
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: line.productId } })).stockQuantity,
    ).toBe(stock + 1)
  })
  it('uses the rejected gross quantity and keeps penalties scoped to the designer', async () => {
    const f = await seed()
    const second = await seed()
    await db.orderLine.create({
      data: {
        orderId: f.order.id,
        productId: second.order.lines[0]!.productId,
        sellerId: second.seller.id,
        productName: 'İkinci tasarımcı',
        quantity: 2,
        unitPrice: 1200,
        totalPrice: 2400,
        commissionRate: 0.2,
        commissionAmount: 576,
        taxRate: 0.2,
      },
    })
    const service = createPenaltyService({ prisma: db })
    const first = await service.applyForCancellation({
      orderId: f.order.id,
      sellerId: f.seller.id,
      reason: 'seller_rejected_paid_order',
      baseAmount: new Decimal(1200),
    })
    const other = await service.applyForCancellation({
      orderId: f.order.id,
      sellerId: second.seller.id,
      reason: 'seller_rejected_paid_order',
      baseAmount: new Decimal(1200),
    })
    expect(first.id).not.toBe(other.id)
    expect(other.baseAmount.toString()).toBe('1200')
    expect(other.penaltyAmount.toString()).toBe('240')
    expect(
      (
        await service.applyForCancellation({
          orderId: f.order.id,
          sellerId: second.seller.id,
          reason: 'seller_rejected_paid_order',
          baseAmount: new Decimal(1200),
        })
      ).id,
    ).toBe(other.id)
    await db.order.update({ where: { id: f.order.id }, data: { status: 'shipped' } })
    await db.orderSellerFulfillment.createMany({
      data: [
        { orderId: f.order.id, sellerId: f.seller.id, status: 'cancelled' },
        { orderId: f.order.id, sellerId: second.seller.id, status: 'shipped' },
      ],
    })
    const orders = createOrderRepository(db)
    expect(
      (
        await orders.listForSellerQueue({
          sellerId: f.seller.id,
          status: ['cancelled_by_customer'],
        })
      )[0]!.sellerOperationalStatus,
    ).toBe('cancelled')
    expect(await orders.countForSellerQueue({ sellerId: f.seller.id, status: ['shipped'] })).toBe(0)
    expect(
      await orders.countForSellerQueue({ sellerId: second.seller.id, status: ['shipped'] }),
    ).toBe(1)
  })
  it('completes an EFT refund with durable customer/designer notifications and keeps invoice edits financially inert', async () => {
    const f = await seed()
    const documents = createOrderDocumentService({ prisma: db, storage })
    const purchase = await documents.uploadInvoiceForSeller({
      orderId: f.order.id,
      sellerId: f.seller.id,
      actorId: f.designer.id,
      fileName: 'purchase.pdf',
      mimeType: 'application/pdf',
      body: PDF,
      sizeBytes: PDF.length,
    })
    // Türkiye calendar day, as the admin enters it (the UTC date lags before 03:00).
    const day = getReportingDateKey(new Date())
    await documents.reviewSellerInvoice({
      orderId: f.order.id,
      sellerId: f.seller.id,
      actorId: f.admin.id,
      decision: 'approve',
      expectedRevision: purchase.revision,
      invoiceNumber: 'TEST-ALIS-1',
      invoiceDate: day,
    })
    const refunds = createQuantityRefundService({ prisma: db })
    const refund = await refunds.queue({
      orderId: f.order.id,
      sellerId: f.seller.id,
      sourceType: 'return_request',
      sourceId: f.rr.id,
      customerAmount: new Decimal(1200),
      grossProductAmount: new Decimal(1200),
      sellerAdjustmentAmount: new Decimal(912),
      commissionAdjustmentAmount: new Decimal(288),
      items: [
        {
          orderLineId: f.order.lines[0]!.id,
          quantity: 1,
          amount: new Decimal(1200),
        },
      ],
    })
    expect(refund.status).toBe('manual_required')
    const invoices = createSellerReturnInvoiceService({ prisma: db, storage })
    const identity = {
      returnRequestId: f.rr.id,
      sellerId: f.seller.id,
      actorId: f.admin.id,
    }
    expect((await invoices.getForAdmin(identity)).ready).toBe(false)
    await refunds.complete({
      refundTransactionId: refund.id,
      orderId: f.order.id,
      actorId: f.admin.id,
      providerReference: 'LOCAL-EFT-1',
      expectedOutstandingAmount: '1200.00',
    })
    expect((await db.returnRequest.findUniqueOrThrow({ where: { id: f.rr.id } })).status).toBe(
      'refund_completed',
    )
    expect(
      await db.notificationOutbox.count({
        where: { eventKey: { startsWith: 'refund:' + refund.id + ':' } },
      }),
    ).toBe(2)
    const before = await db.sellerLedgerEntry.findMany({
      where: { sellerId: f.seller.id },
      orderBy: { id: 'asc' },
    })
    const saved = await invoices.upload({
      ...identity,
      invoiceNumber: 'TEST-IADE-1',
      invoiceDate: day,
      fileName: 'return.pdf',
      mimeType: 'application/pdf',
      body: PDF,
    })
    expect(saved!.amount.toFixed(2)).toBe('912.00')
    expect(saved!.vatGroups).toEqual([
      {
        taxRate: '0.2000',
        amount: '912.00',
        netAmount: '760.00',
        vatAmount: '152.00',
      },
    ])
    const revised = await invoices.update({
      ...identity,
      expectedRevision: saved!.revision,
      reason: 'Fatura numarası düzeltildi',
      invoiceNumber: 'TEST-IADE-2',
      invoiceDate: day,
    })
    expect(revised!.revision).not.toBe(saved!.revision)
    await expect(
      invoices.update({
        ...identity,
        expectedRevision: saved!.revision,
        reason: 'Eski sürüm ile düzeltme',
        invoiceNumber: 'WRONG',
        invoiceDate: day,
      }),
    ).rejects.toMatchObject({ statusCode: 412 })
    expect(
      await db.sellerLedgerEntry.findMany({
        where: { sellerId: f.seller.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before)
    expect(
      await db.notificationOutbox.count({
        where: { type: 'seller_return_invoice_uploaded', userId: f.designer.id },
      }),
    ).toBe(1)
    await invoices.remove({
      ...identity,
      expectedRevision: revised!.revision,
      reason: 'Yerel test belgesi kaldırıldı',
    })
    expect(
      await db.sellerLedgerEntry.findMany({
        where: { sellerId: f.seller.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before)
  })
  it('rolls back the final rejection if its notification fails and retries without duplicate decisions', async () => {
    const f = await seed()
    const dispute = await db.dispute.create({
      data: {
        orderId: f.order.id,
        openedById: f.designer.id,
        reason: 'Tasarımcı iç incelemesi',
      },
    })
    await db.returnRequest.update({
      where: { id: f.rr.id },
      data: {
        status: 'rejected',
        disputeId: dispute.id,
        sellerRejectedAt: new Date(),
      },
    })
    const broken = db.$extends({
      query: {
        notificationOutbox: {
          async upsert() {
            throw Error('SIMULATED_OUTBOX_FAILURE')
          },
        },
      },
    })
    const params = {
      disputeId: dispute.id,
      adminActorId: f.admin.id,
      resolutionType: 'resolved_for_seller' as const,
      resolution: 'Telefonla uzlaşıldı; ürün müşteriye gönderilecek. Takip: TEST-1.',
    }
    await expect(
      createDisputeService({
        prisma: broken as unknown as PrismaClient,
      }).resolveDispute(params),
    ).rejects.toThrow('SIMULATED_OUTBOX_FAILURE')
    expect((await db.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe('open')
    expect(
      (await db.returnRequest.findUniqueOrThrow({ where: { id: f.rr.id } })).reviewedAt,
    ).toBeNull()
    const svc = createDisputeService({ prisma: db })
    await svc.resolveDispute(params)
    await svc.resolveDispute(params)
    const rr = await db.returnRequest.findUniqueOrThrow({
      where: { id: f.rr.id },
    })
    expect(rr.status).toBe('rejected')
    expect(rr.reviewedAt).not.toBeNull()
    expect(
      await db.notificationOutbox.count({
        where: {
          eventKey: { startsWith: 'dispute:' + dispute.id + ':resolved:' },
        },
      }),
    ).toBe(2)
    expect(
      await db.returnMessage.count({
        where: { returnRequestId: f.rr.id, authorRole: 'admin' },
      }),
    ).toBe(1)
    const rows = await createReturnRequestRepository(db).listForSeller({
      sellerId: f.seller.id,
    })
    expect(rows[0]!.reason).toBe('Hanuja iade incelemesi')
    expect(rows[0]!.description).toBeNull()
  })
})
