import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cp, copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createOrderDocumentService } from '../../api/services/order-document.service'
import { createPrivateDocumentStorage, type PrivateDocumentStorage } from '../../api/lib/private-document-storage'
import { getInvoiceRevision, SELLER_INVOICE_EDIT_WINDOW_MS } from '../../api/lib/invoice-management'
import { processPrivateDocumentCleanup, schedulePrivateDocumentCleanup } from '../../api/services/private-document-cleanup.service'

// These tests never use the application's DATABASE_URL. Both database name and
// host are checked before any migration, fixture write or cleanup is possible.
const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl) throw new Error('NOTIFICATION_TEST_DATABASE_URL must target disposable local hanuja_notification_test')
const url = new URL(testUrl)
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/hanuja_notification_test'
) throw new Error('Refusing invoice tests outside local hanuja_notification_test')
const schema = `invoice_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })
const migrationName = '20261007190000_order_invoice_management'
const schemaPath = resolve('../db/schema/schema.prisma')
const prismaCli = resolve('../db/node_modules/prisma/build/index.js')
const PDF = Buffer.from('%PDF-1.7\nHanuja invoice lifecycle test\n%%EOF', 'utf8')
let storage: PrivateDocumentStorage
let storageRoot: string
let previousMigrationRoot: string
let backfillFixture: Awaited<ReturnType<typeof seed>>
let backfillFirstUploadedAt: Date

function migrate(path: string) {
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path], {
    env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe',
  })
}

beforeAll(async () => {
  vi.stubEnv('INVOICE_MANAGEMENT_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
  storageRoot = await mkdtemp(join(tmpdir(), 'hanuja-invoice-storage-test-'))
  storage = createPrivateDocumentStorage({ root: storageRoot, encryptionKey: Buffer.alloc(32, 0x31) })

  // Apply the historical migrations first, seed a genuinely pre-migration invoice,
  // then apply the real additive migration to prove the createdAt backfill.
  previousMigrationRoot = await mkdtemp(join(tmpdir(), 'hanuja-invoice-migrations-test-'))
  const priorSchema = join(previousMigrationRoot, 'schema.prisma')
  await copyFile(schemaPath, priorSchema)
  const migrationsRoot = resolve('../db/schema/migrations')
  for (const entry of await readdir(migrationsRoot)) {
    if (entry === migrationName) continue
    await cp(join(migrationsRoot, entry), join(previousMigrationRoot, 'migrations', entry), { recursive: true })
  }
  migrate(priorSchema)
  await prisma.$connect()
  backfillFixture = await seed()
  backfillFirstUploadedAt = new Date(Date.now() - 40 * 24 * 60 * 60_000)
  const savedFile = await storage.write(PDF)
  await prisma.orderSellerInvoice.create({
    data: {
      orderId: backfillFixture.order.id, sellerId: backfillFixture.seller.id,
      fileUrl: 'private://seller-invoice', fileKey: savedFile.key, fileName: 'legacy.pdf',
      mimeType: 'application/pdf', sizeBytes: PDF.length, source: 'manual',
      createdAt: backfillFirstUploadedAt, uploadedAt: new Date(),
    },
  })
  migrate(schemaPath)
})

afterEach(() => vi.useRealTimers())

afterAll(async () => {
  if (!/^invoice_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid disposable invoice schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
  for (const directory of [storageRoot, previousMigrationRoot]) {
    if (directory) {
      const absolute = resolve(directory)
      if (!absolute.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(absolute).startsWith('hanuja-invoice-')) {
        throw new Error('Refusing cleanup outside the disposable invoice test directories')
      }
      await rm(absolute, { recursive: true, force: true })
    }
  }
  vi.unstubAllEnvs()
})

async function seed() {
  const tag = randomUUID()
  const customer = await prisma.user.create({ data: { email: `buyer-${tag}@example.test`, name: 'Test müşteri' } })
  const admin = await prisma.user.create({ data: { email: `admin-${tag}@example.test`, role: 'admin' } })
  const sellerUser = await prisma.user.create({ data: { email: `seller-${tag}@example.test`, role: 'seller' } })
  const outsider = await prisma.user.create({ data: { email: `outsider-${tag}@example.test`, role: 'seller' } })
  const seller = await prisma.seller.create({
    data: { userId: sellerUser.id, slug: `seller-${tag}`, displayName: 'Invoice Test Atelier', status: 'active' },
  })
  const product = await prisma.product.create({
    data: { sellerId: seller.id, name: 'Test Ürün', slug: `product-${tag}`, price: 100, stockQuantity: 5 },
  })
  const order = await prisma.order.create({
    data: {
      customerId: customer.id, status: 'payment_confirmed', paymentConfirmedAt: new Date(), grossAmount: 100, totalAmount: 100,
      lines: { create: {
        productId: product.id, sellerId: seller.id, productName: product.name, quantity: 1,
        unitPrice: 100, totalPrice: 100, customerPaidProductAmount: 100, netPayoutAmount: 100,
      } },
    },
  })
  return { customer, admin, sellerUser, outsider, seller, order }
}

type Fixture = Awaited<ReturnType<typeof seed>>
const service = () => createOrderDocumentService({ prisma, storage })
const pair = (f: Fixture) => ({ orderId: f.order.id, sellerId: f.seller.id })
const pairWhere = (f: Fixture) => ({ orderId_sellerId: pair(f) })
const uploadParams = (f: Fixture, extra = {}) => ({
  ...pair(f), actorId: f.sellerUser.id,
  fileName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, body: PDF,
  ...extra,
})
const removeParams = (f: Fixture, revision: string, extra = {}) => ({
  ...pair(f), actorId: f.sellerUser.id, expectedRevision: revision, reason: 'Yanlış yüklenen test faturası', ...extra,
})
const invoice = (f: Fixture) => prisma.orderSellerInvoice.findUnique({ where: pairWhere(f) })
const policy = (f: Fixture) => prisma.orderSellerInvoicePolicy.findUniqueOrThrow({ where: pairWhere(f) })
const uploadedOutboxCount = (f: Fixture) => prisma.notificationOutbox.count({
  where: { userId: f.customer.id, type: 'invoice_uploaded' },
})

async function inbound(f: Fixture, messageId = `resend:${randomUUID()}`) {
  const aliasEmail = `pf${randomUUID().replaceAll('-', '').slice(0, 10)}@fatura.example.test`
  await prisma.orderEmailAlias.upsert({
    where: { orderId_sellerId_purpose: { ...pair(f), purpose: 'invoice' } },
    create: { ...pair(f), aliasEmail, localPart: aliasEmail.split('@')[0]!, purpose: 'invoice', status: 'active' },
    update: {},
  })
  const alias = await prisma.orderEmailAlias.findUniqueOrThrow({
    where: { orderId_sellerId_purpose: { ...pair(f), purpose: 'invoice' } },
  })
  return {
    messageId, recipients: [alias.aliasEmail], fromEmail: 'sender@example.test',
    loadAttachment: vi.fn(async () => ({ fileName: 'inbound.pdf', mimeType: 'application/pdf', body: PDF })),
  }
}

describe('invoice lifecycle on real PostgreSQL', () => {
  it('backfills the immutable first upload from createdAt, not the most recent uploadedAt', async () => {
    const legacyPolicy = await policy(backfillFixture)
    expect(legacyPolicy.firstUploadedAt).toEqual(backfillFirstUploadedAt)
    const management = await service().getInvoiceManagementForSeller(backfillFixture.order.id, backfillFixture.seller.id)
    expect(management.canEdit).toBe(false)
    expect(management.sellerEditDeadline).toEqual(new Date(backfillFirstUploadedAt.getTime() + SELLER_INVOICE_EDIT_WINDOW_MS))
  })

  it('keeps the first upload after replacement, removal and re-upload; removal sends no notification', async () => {
    const f = await seed()
    const first = await service().uploadInvoiceForSeller(uploadParams(f))
    const firstDate = (await policy(f)).firstUploadedAt
    const original = await invoice(f)
    const replacement = await service().uploadInvoiceForSeller(uploadParams(f, { expectedRevision: first.revision, reason: 'Doğru test faturasıyla değiştirildi' }))
    expect((await policy(f)).firstUploadedAt).toEqual(firstDate)
    expect(await storage.exists(original!.fileKey)).toBe(false)
    const beforeRemoval = await uploadedOutboxCount(f)
    const replaced = await invoice(f)
    await service().removeInvoiceForSeller(removeParams(f, replacement.revision))
    expect(await invoice(f)).toBeNull()
    expect(await storage.exists(replaced!.fileKey)).toBe(false)
    expect(await uploadedOutboxCount(f)).toBe(beforeRemoval)
    expect((await policy(f)).firstUploadedAt).toEqual(firstDate)
    await service().uploadInvoiceForSeller(uploadParams(f))
    expect((await policy(f)).firstUploadedAt).toEqual(firstDate)
    expect(await uploadedOutboxCount(f)).toBe(beforeRemoval + 1)
    const audit = await prisma.adminAuditLog.findMany({ where: { targetType: 'order', targetId: f.order.id }, orderBy: { createdAt: 'asc' } })
    expect(audit.map(row => row.actionType)).toEqual(['order_invoice_uploaded', 'order_invoice_replaced', 'order_invoice_removed', 'order_invoice_uploaded'])
    expect(audit.every(row => row.actorId === f.sellerUser.id && !!row.reason)).toBe(true)
  })

  it('serializes concurrent seller replacement and removal: one succeeds and one is stale', async () => {
    const f = await seed()
    const first = await service().uploadInvoiceForSeller(uploadParams(f))
    const results = await Promise.allSettled([
      service().uploadInvoiceForSeller(uploadParams(f, { expectedRevision: first.revision, reason: 'Eşzamanlı doğru dosya yüklemesi' })),
      service().removeInvoiceForSeller(removeParams(f, first.revision)),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(failure.reason).toMatchObject({ statusCode: 412, code: 'INVOICE_CHANGED' })
    expect(await prisma.adminAuditLog.count({ where: { targetId: f.order.id, actionType: { in: ['order_invoice_replaced', 'order_invoice_removed'] } } })).toBe(1)
    const saved = await invoice(f)
    if (saved) expect(await storage.exists(saved.fileKey)).toBe(true)
    expect(await prisma.privateDocumentCleanup.count({ where: { status: 'pending' } })).toBe(0)
  })

  it('requires the current revision and enforces seller/admin ownership in the service', async () => {
    const f = await seed()
    const first = await service().uploadInvoiceForSeller(uploadParams(f))
    await expect(service().removeInvoiceForSeller({ ...removeParams(f, first.revision), expectedRevision: undefined }))
      .rejects.toMatchObject({ statusCode: 428 })
    await expect(service().uploadInvoiceForSeller(uploadParams(f, { reason: 'Yanlış revizyonla değiştirme' })))
      .rejects.toMatchObject({ statusCode: 428 })
    await expect(service().removeInvoiceForSeller(removeParams(f, first.revision, { actorId: f.outsider.id })))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(service().removeInvoiceForAdmin(removeParams(f, first.revision, { actorId: f.sellerUser.id })))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(getInvoiceRevision((await invoice(f))!)).toBe(first.revision)
    await expect(service().getInvoiceForCustomer(f.order.id, f.outsider.id, f.seller.id))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('allows a change immediately before 30 days and blocks seller mutations at the exact boundary', async () => {
    const f = await seed()
    const first = await service().uploadInvoiceForSeller(uploadParams(f))
    const firstDate = (await policy(f)).firstUploadedAt
    const deadline = firstDate.getTime() + SELLER_INVOICE_EDIT_WINDOW_MS
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(deadline - 1)
    const replaced = await service().uploadInvoiceForSeller(uploadParams(f, { expectedRevision: first.revision, reason: 'Süre dolmadan test düzeltmesi' }))
    vi.setSystemTime(deadline)
    await expect(service().removeInvoiceForSeller(removeParams(f, replaced.revision)))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(service().uploadInvoiceForSeller(uploadParams(f, { expectedRevision: replaced.revision, reason: 'Süre sınırında test düzeltmesi' })))
      .rejects.toMatchObject({ statusCode: 403 })
    expect((await policy(f)).firstUploadedAt).toEqual(firstDate)
    expect((await service().getInvoiceManagementForSeller(f.order.id, f.seller.id)).canEdit).toBe(false)
  })

  it('lets admin remove/re-upload after expiry while seller cannot reset the window', async () => {
    const f = await seed()
    const first = await service().uploadInvoiceForSeller(uploadParams(f))
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60_000)
    await prisma.orderSellerInvoicePolicy.update({ where: pairWhere(f), data: { firstUploadedAt: oldDate } })
    await service().removeInvoiceForAdmin(removeParams(f, first.revision, { actorId: f.admin.id }))
    await expect(service().uploadInvoiceForSeller(uploadParams(f))).rejects.toMatchObject({ statusCode: 403 })
    const restored = await service().uploadInvoiceForAdmin(uploadParams(f, { actorId: f.admin.id }))
    expect(restored.revision).toBeTruthy()
    expect((await policy(f)).firstUploadedAt).toEqual(oldDate)
    const audit = await prisma.adminAuditLog.findFirst({ where: { targetId: f.order.id, actionType: 'order_invoice_removed' } })
    expect(audit!.actorId).toBe(f.admin.id)
    expect(audit!.newData).toMatchObject({ actorRole: 'admin', removed: true })
  })

  it('does not restore a removed invoice on inbound replay and blocks new inbound after expiry', async () => {
    const f = await seed()
    const mail = await inbound(f)
    const accepted = await service().ingestInboundInvoiceEmail(mail)
    expect(accepted.status).toBe('processed')
    const uploaded = (await invoice(f))!
    await service().removeInvoiceForSeller(removeParams(f, getInvoiceRevision(uploaded)))
    const beforeReplay = await uploadedOutboxCount(f)
    expect((await service().ingestInboundInvoiceEmail(mail)).status).toBe('duplicate')
    expect(mail.loadAttachment).toHaveBeenCalledOnce()
    expect(await invoice(f)).toBeNull()
    expect(await prisma.inboundEmail.count({ where: { messageId: mail.messageId } })).toBe(1)
    await prisma.orderSellerInvoicePolicy.update({
      where: pairWhere(f), data: { firstUploadedAt: new Date(Date.now() - 40 * 24 * 60 * 60_000) },
    })
    const blocked = await service().ingestInboundInvoiceEmail(await inbound(f))
    expect(blocked.status).toBe('blocked_invoice_policy')
    expect(await invoice(f)).toBeNull()
    expect(await uploadedOutboxCount(f)).toBe(beforeReplay)
    expect(await prisma.privateDocumentCleanup.count({ where: { status: 'pending' } })).toBe(0)
  })

  it('deduplicates concurrent inbound deliveries in PostgreSQL without duplicate invoice, audit or notification', async () => {
    const f = await seed()
    const mail = await inbound(f)
    const results = await Promise.all([
      service().ingestInboundInvoiceEmail(mail), service().ingestInboundInvoiceEmail(mail),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['duplicate', 'processed'])
    expect(await prisma.orderSellerInvoice.count({ where: pair(f) })).toBe(1)
    expect(await prisma.inboundEmail.count({ where: { messageId: mail.messageId } })).toBe(1)
    expect(await uploadedOutboxCount(f)).toBe(1)
    expect(await prisma.adminAuditLog.count({ where: { targetId: f.order.id } })).toBe(1)
    expect(await prisma.privateDocumentCleanup.count({ where: { status: 'pending' } })).toBe(0)
  })

  it('prevents concurrent cleanup runners deleting twice through a real PostgreSQL advisory lock', async () => {
    const saved = await storage.write(PDF)
    await prisma.$transaction(tx => schedulePrivateDocumentCleanup(tx, saved.key))
    let release: () => void
    let entered: () => void
    const gate = new Promise<void>(resolveGate => { release = resolveGate })
    const started = new Promise<void>(resolveStarted => { entered = resolveStarted })
    const deleteFile = vi.fn(async (key: string) => { entered(); await gate; await storage.delete(key) })
    const first = processPrivateDocumentCleanup({ prisma, fileKey: saved.key, deleteFile })
    await started
    try {
      const concurrent = await processPrivateDocumentCleanup({ prisma, fileKey: saved.key, deleteFile })
      expect(concurrent.deferred).toBe(1)
      expect(deleteFile).toHaveBeenCalledOnce()
    } finally {
      release!()
    }
    expect((await first).completed).toBe(1)
    expect(await storage.exists(saved.key)).toBe(false)
    expect((await prisma.privateDocumentCleanup.findUniqueOrThrow({ where: { fileKey: saved.key } })).status).toBe('completed')
  })

  it('preserves an active invoice when PostgreSQL commits but the caller loses the COMMIT response', async () => {
    const f = await seed()
    const realTransaction = prisma.$transaction.bind(prisma)
    let loseFirstCommitResponse = true
    const transaction = vi.spyOn(prisma, '$transaction').mockImplementation((async (input: unknown, options: unknown) => {
      const committed = await realTransaction(input as never, options as never)
      if (loseFirstCommitResponse) {
        loseFirstCommitResponse = false
        throw new Error('Simulated lost COMMIT response')
      }
      return committed
    }) as never)
    try {
      await expect(service().uploadInvoiceForSeller(uploadParams(f)))
        .rejects.toThrow('Simulated lost COMMIT response')
    } finally {
      transaction.mockRestore()
    }
    const active = await invoice(f)
    expect(active).not.toBeNull()
    expect(await storage.exists(active!.fileKey)).toBe(true)
    expect(await service().readInvoiceFile(active!.fileKey)).toMatchObject({ body: PDF })
    expect(await uploadedOutboxCount(f)).toBe(1)
    const intent = await prisma.privateDocumentCleanup.findUniqueOrThrow({ where: { fileKey: active!.fileKey } })
    expect(intent.status).toBe('pending')
    expect(intent.lastError).toBe('File is still referenced by an active invoice.')
    expect(intent.attempts).toBe(0)
  })
})
