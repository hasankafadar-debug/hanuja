/**
 * Satıcı Hanuja modeli on real PostgreSQL: the seller's invoice to Hanuja drives the payout
 * term (first Friday on/after invoice date + 30 days), delivery confirmation is still
 * required, rejection notifies and blocks, the reminder is written once, and Hanuja's
 * customer invoice is announced once per file revision.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createOrderDocumentService } from '../../api/services/order-document.service'
import { createCustomerInvoiceService } from '../../api/services/customer-invoice.service'
import { createPayoutService } from '../../api/services/payout.service'
import { createReadyPayoutBatch } from '../../api/services/payout-batch.service'
import { sweepSellerInvoiceReminders } from '../../api/services/seller-invoice-reminder.service'
import {
  createPrivateDocumentStorage,
  type PrivateDocumentStorage,
} from '../../api/lib/private-document-storage'

// Never the application's DATABASE_URL: host and database name are checked first.
const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error(
    'NOTIFICATION_TEST_DATABASE_URL must target disposable local hanuja_notification_test',
  )
const url = new URL(testUrl)
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/hanuja_notification_test'
)
  throw new Error('Refusing purchase invoice tests outside local hanuja_notification_test')
const schema = `purchase_invoice_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({
  datasources: { db: { url: url.toString() } },
})
const PDF = Buffer.from('%PDF-1.7\nHanuja purchase invoice test\n%%EOF', 'utf8')
let storage: PrivateDocumentStorage
let storageRoot: string

beforeAll(async () => {
  vi.stubEnv('INVOICE_MANAGEMENT_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://satici.hanuja.com.tr')
  storageRoot = await mkdtemp(join(tmpdir(), 'hanuja-purchase-invoice-test-'))
  storage = createPrivateDocumentStorage({
    root: storageRoot,
    encryptionKey: Buffer.alloc(32, 0x32),
  })
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

afterEach(() => vi.useRealTimers())

afterAll(async () => {
  if (!/^purchase_invoice_test_[a-f0-9]{32}$/.test(schema))
    throw new Error('Invalid disposable schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
  if (storageRoot) {
    const absolute = resolve(storageRoot)
    if (
      !absolute.startsWith(`${resolve(tmpdir())}${sep}`) ||
      !basename(absolute).startsWith('hanuja-purchase-invoice-')
    ) {
      throw new Error('Refusing cleanup outside the disposable test directory')
    }
    await rm(absolute, { recursive: true, force: true })
  }
  vi.unstubAllEnvs()
})

async function seed() {
  const tag = randomUUID()
  const customer = await prisma.user.create({
    data: { email: `buyer-${tag}@example.test`, name: 'Test Müşteri' },
  })
  const outsider = await prisma.user.create({
    data: { email: `outsider-${tag}@example.test`, name: 'Başka Müşteri' },
  })
  const admin = await prisma.user.create({
    data: { email: `admin-${tag}@example.test`, role: 'admin' },
  })
  const sellerUser = await prisma.user.create({
    data: { email: `seller-${tag}@example.test`, role: 'seller' },
  })
  const seller = await prisma.seller.create({
    data: {
      userId: sellerUser.id,
      slug: `seller-${tag}`,
      displayName: 'Atelier Test',
      status: 'active',
    },
  })
  await prisma.sellerBankDetail.create({
    data: {
      sellerId: seller.id,
      iban: 'TR330006100519786457841326',
      accountHolder: 'Atelier Test',
      bankName: 'Test Bankası',
      status: 'ACTIVE',
      isActive: true,
      isVerified: true,
      verifiedAt: new Date('2026-08-01T00:00:00Z'),
    },
  })
  const product = await prisma.product.create({
    data: {
      sellerId: seller.id,
      name: 'Gea Berjer',
      slug: `product-${tag}`,
      price: 1000,
      stockQuantity: 5,
    },
  })
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      status: 'payment_confirmed',
      paymentConfirmedAt: new Date('2026-09-01T09:00:00Z'),
      grossAmount: 1000,
      totalAmount: 1000,
      lines: {
        create: {
          productId: product.id,
          sellerId: seller.id,
          productName: product.name,
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
          customerPaidProductAmount: 1000,
          taxRate: 0.2,
          // 1.000 × %20 × 1,20: the seller invoices Hanuja 760 TL, which is also the payout net.
          commissionRate: 0.2,
          commissionAmount: 240,
          netPayoutAmount: 760,
        },
      },
    },
  })
  return { customer, outsider, admin, sellerUser, seller, order }
}

type Fixture = Awaited<ReturnType<typeof seed>>
const documents = () => createOrderDocumentService({ prisma, storage })
const payouts = () => createPayoutService({ prisma })
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}
const upload = (f: Fixture, extra: Record<string, unknown> = {}) =>
  documents().uploadInvoiceForSeller({
    orderId: f.order.id,
    sellerId: f.seller.id,
    actorId: f.sellerUser.id,
    fileName: 'fatura.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    body: PDF,
    ...extra,
  })
const review = (f: Fixture, revision: string, decision: Record<string, unknown>) =>
  documents().reviewSellerInvoice({
    orderId: f.order.id,
    sellerId: f.seller.id,
    actorId: f.admin.id,
    expectedRevision: revision,
    ...decision,
  } as never)
async function confirmDelivery(f: Fixture, iso: string) {
  const deliveryConfirmedAt = new Date(iso)
  await prisma.order.update({
    where: { id: f.order.id },
    data: { status: 'delivery_confirmed', deliveryConfirmedAt },
  })
  const [payout] = await payouts().activateHold({
    orderId: f.order.id,
    deliveryConfirmedAt,
  })
  return payout!
}

describe('seller-Hanuja invoice flow on real PostgreSQL', () => {
  it('persists the next Friday after Monday unblock across worker, batch and payment checks', async () => {
    const f = await seed()
    at('2026-09-07T10:00:00Z')
    const invoice = await upload(f)
    await review(f, invoice.revision, {
      decision: 'approve',
      invoiceNumber: 'ATL2026000000099',
      invoiceDate: '2026-09-07',
    })
    const payout = await confirmDelivery(f, '2026-09-10T12:00:00Z')
    at('2026-10-09T09:00:00Z')
    await payouts().reevaluate(payout.id)
    await payouts().block({
      payoutId: payout.id,
      adminActorId: f.admin.id,
      reason: 'Kontrol için yönetici blokesinde',
    })
    at('2026-10-12T09:00:00Z')
    const cleared = await payouts().release({
      payoutId: payout.id,
      adminActorId: f.admin.id,
      clearManualBlock: true,
      reason: 'Kontrol tamamlandı ve bloke kaldırıldı',
    })
    const nextFriday = new Date('2026-10-15T21:00:00Z')
    expect(cleared.nextPaymentAt).toEqual(nextFriday)
    expect(cleared.status).toBe('hold_active')
    expect((await payouts().reevaluate(payout.id)).ready).toBe(false)
    expect((await payouts().paymentContext(payout.id)).ready).toBe(false)
    await createReadyPayoutBatch(prisma)
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).batchId).toBeNull()
    at('2026-10-16T09:00:00Z')
    expect((await payouts().reevaluate(payout.id)).ready).toBe(true)
    expect((await payouts().reevaluate(payout.id)).payout.nextPaymentAt).toEqual(nextFriday)
    const payment = await payouts().paymentContext(payout.id)
    await payouts().markPaid({
      payoutId: payout.id,
      adminActorId: f.admin.id,
      transferDate: new Date(),
      transferReference: 'LOCAL-TEST-ONLY',
      expectedSnapshot: payment.snapshot,
    })
    at('2026-10-23T09:00:00Z')
    expect((await payouts().reevaluate(payout.id)).payout.nextPaymentAt).toEqual(nextFriday)
  })

  it('starts the payout term from the approved invoice and still waits for the due Friday', async () => {
    const f = await seed()
    at('2026-09-07T10:00:00Z')
    const uploaded = await upload(f)
    await review(f, uploaded.revision, {
      decision: 'approve',
      invoiceNumber: 'ATL2026000000017',
      invoiceDate: '2026-09-07',
    })

    const payout = await confirmDelivery(f, '2026-09-10T12:00:00Z')
    expect(payout.netAmount.toFixed(2)).toBe('760.00')
    // Monday 7 Sep + 30 days = Wednesday 7 Oct → Friday 9 Oct 2026, 00:00 Istanbul.
    expect(payout.holdUntil).toEqual(new Date('2026-10-08T21:00:00Z'))

    at('2026-10-08T20:30:00Z')
    const early = await payouts().reevaluate(payout.id)
    expect(early.ready).toBe(false)
    expect(early.payout.status).toBe('hold_active')
    expect(early.automaticReason).toBe('Fatura vadesi dolmadı (ödeme günü: 09.10.2026)')

    at('2026-10-09T06:00:00Z')
    const due = await payouts().reevaluate(payout.id)
    expect(due.ready).toBe(true)
    expect(due.payout.status).toBe('payout_ready')
  })

  it('keeps a delivered payout blocked until the invoice is approved, notifying a rejection', async () => {
    const f = await seed()
    at('2026-09-10T12:00:00Z')
    const payout = await confirmDelivery(f, '2026-09-10T12:00:00Z')
    expect(payout.holdUntil).toBeNull()

    const first = await upload(f)
    await review(f, first.revision, {
      decision: 'reject',
      note: 'Açıklamada sipariş numarası yok.',
    })
    const rejection = await prisma.notificationOutbox.findMany({
      where: { userId: f.sellerUser.id, type: 'seller_invoice_rejected' },
    })
    expect(rejection).toHaveLength(1)
    expect(rejection[0]!.eventKey).toBe(
      `seller-invoice-rejected:${f.order.id}:${f.seller.id}:${first.revision}`,
    )
    expect(
      await prisma.notificationOutbox.count({
        where: { userId: f.customer.id },
      }),
    ).toBe(0)

    at('2026-12-01T09:00:00Z')
    const blocked = await payouts().reevaluate(payout.id)
    expect(blocked.ready).toBe(false)
    expect(blocked.automaticReason).toContain("Tasarımcının Hanuja'ya faturası onaylanmadı")

    at('2026-09-12T09:00:00Z')
    const corrected = await upload(f, {
      expectedRevision: first.revision,
      reason: 'Sipariş numarası eklendi',
    })
    expect(
      (
        await prisma.orderSellerInvoice.findUniqueOrThrow({
          where: {
            orderId_sellerId: { orderId: f.order.id, sellerId: f.seller.id },
          },
        })
      ).reviewStatus,
    ).toBe('pending')
    await review(f, corrected.revision, {
      decision: 'approve',
      invoiceNumber: 'ATL2026000000018',
      invoiceDate: '2026-09-12',
    })
    // Saturday 12 Sep + 30 days = Monday 12 Oct → Friday 16 Oct 2026.
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).holdUntil).toEqual(
      new Date('2026-10-15T21:00:00Z'),
    )

    await expect(
      upload(f, {
        expectedRevision: corrected.revision,
        reason: 'Yeni dosya denemesi',
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    const audit = await prisma.adminAuditLog.findMany({
      where: {
        targetId: f.order.id,
        actionType: {
          in: ['seller_invoice_approved', 'seller_invoice_rejected'],
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map((row) => [row.actionType, row.actorId])).toEqual([
      ['seller_invoice_rejected', f.admin.id],
      ['seller_invoice_approved', f.admin.id],
    ])
  })

  it('writes the invoice reminder once and never for an invoiced order', async () => {
    const reminded = await seed()
    const invoiced = await seed()
    const now = new Date()
    for (const f of [reminded, invoiced]) {
      await prisma.shipment.create({
        data: {
          orderId: f.order.id,
          sellerId: f.seller.id,
          cargoProvider: 'aras',
          trackingNumber: 'TEST123',
          status: 'handed_to_cargo',
          handedAt: new Date(now.getTime() - 2 * 60 * 60_000),
        },
      })
    }
    await upload(invoiced)

    await sweepSellerInvoiceReminders({ prisma, now })
    const second = await sweepSellerInvoiceReminders({ prisma, now })
    expect(second.reminded).toBe(0)
    expect(
      await prisma.notificationOutbox.count({
        where: {
          userId: reminded.sellerUser.id,
          type: 'seller_invoice_reminder',
        },
      }),
    ).toBe(1)
    expect(
      await prisma.notificationOutbox.count({
        where: {
          userId: invoiced.sellerUser.id,
          type: 'seller_invoice_reminder',
        },
      }),
    ).toBe(0)
  })

  it("announces Hanuja's customer invoice once per file and shows it only to the buyer", async () => {
    const f = await seed()
    const customerInvoices = createCustomerInvoiceService({ prisma, storage })
    const first = await customerInvoices.uploadForAdmin({
      orderId: f.order.id,
      actorId: f.admin.id,
      fileName: 'hanuja-fatura.pdf',
      mimeType: 'application/pdf',
      body: PDF,
      invoiceNumber: 'HNJ2026000000001',
    })
    const outbox = () =>
      prisma.notificationOutbox.findMany({
        where: { userId: f.customer.id, type: 'invoice_uploaded' },
        orderBy: { createdAt: 'asc' },
      })
    expect((await outbox()).map((row) => row.eventKey)).toEqual([
      `customer-invoice:${f.order.id}:${first.revision}`,
    ])

    const second = await customerInvoices.uploadForAdmin({
      orderId: f.order.id,
      actorId: f.admin.id,
      fileName: 'hanuja-fatura-duzeltilmis.pdf',
      mimeType: 'application/pdf',
      body: PDF,
      invoiceNumber: 'HNJ2026000000002',
      expectedRevision: first.revision,
      reason: 'Fatura numarası düzeltildi',
    })
    expect((await outbox()).map((row) => row.eventKey)).toEqual([
      `customer-invoice:${f.order.id}:${first.revision}`,
      `customer-invoice:${f.order.id}:${second.revision}`,
    ])

    await expect(customerInvoices.getForCustomer(f.order.id, f.customer.id)).resolves.toMatchObject(
      { fileName: 'hanuja-fatura-duzeltilmis.pdf' },
    )
    await expect(customerInvoices.getForCustomer(f.order.id, f.outsider.id)).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(await customerInvoices.listForCustomer(f.outsider.id)).toEqual([])
  })
})
