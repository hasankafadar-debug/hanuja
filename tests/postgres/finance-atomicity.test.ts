import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createPayoutService } from '../../api/services/payout.service'
import { createQuantityRefundService } from '../../api/services/quantity-refund.service'
import { createCommissionExemptionService } from '../../api/services/commission-exemption.service'
import { allocateProductRefund } from '../../api/domain/quantity-allocation'
import { createQuantityCancellationService } from '../../api/services/quantity-cancellation.service'
import { createQuantityReturnService } from '../../api/services/quantity-return.service'
import { createDisputeService } from '../../api/services/dispute.service'
import { createPayoutRepository } from '../../api/repositories/payout.repository'
import { createReadyPayoutBatch } from '../../api/services/payout-batch.service'

vi.mock('../../api/jobs/notification-dispatch.job', () => ({ enqueueNotification: vi.fn(async () => undefined) }))

vi.mock('../../api/jobs/refund-processing.job', () => ({
  enqueueRefundProcessing: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/refund-notification.service', () => ({
  enqueueCustomerRefundCompletedNotification: vi.fn(),
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
const confirmedAt = new Date('2026-01-01T00:00:00Z')

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

async function fixture(sellerCount = 1) {
  const tag = randomUUID()
  const admin = await prisma.user.create({ data: { email: `admin-${tag}@example.test`, role: 'admin' } })
  const order = await prisma.order.create({ data: {
    customerId: admin.id, status: 'delivery_confirmed', quantityLifecycleVersion: 2,
    grossAmount: sellerCount * 1000, totalAmount: sellerCount * 1000,
    paymentConfirmedAt: confirmedAt, deliveryConfirmedAt: confirmedAt,
  } })
  const sellerIds: string[] = []
  const lineIds: string[] = []
  for (let i = 0; i < sellerCount; i++) {
    const sellerUser = await prisma.user.create({ data: { email: `seller-${i}-${tag}@example.test` } })
    const seller = await prisma.seller.create({ data: {
      userId: sellerUser.id, slug: `seller-${i}-${tag}`, displayName: 'Finance test', status: 'active',
    } })
    await prisma.sellerBankDetail.create({ data: {
      sellerId: seller.id, iban: 'TR00000000000000000000000000', accountHolder: 'Finance test',
      bankName: 'Test bank', status: 'ACTIVE', isActive: true, isVerified: true,
    } })
    const product = await prisma.product.create({ data: {
      sellerId: seller.id, name: 'Finance test product', slug: `product-${i}-${tag}`, price: 1000,
    } })
    const line = await prisma.orderLine.create({ data: {
      sellerId: seller.id, orderId: order.id, productId: product.id, productName: product.name,
      quantity: 10, unitPrice: 100, totalPrice: 1000, commissionAmount: 180, netPayoutAmount: 820,
    } })
    sellerIds.push(seller.id)
    lineIds.push(line.id)
  }
  await prisma.payment.create({ data: {
    orderId: order.id, method: 'eft', provider: 'manual_eft', status: 'confirmed',
    amount: sellerCount * 1000, confirmedAt,
  } })
  return { orderId: order.id, sellerIds, lineIds, adminId: admin.id }
}

const hold = (orderId: string, client = prisma) =>
  createPayoutService({ prisma: client }).activateHold({ orderId, deliveryConfirmedAt: confirmedAt })

async function readyFixture(sellerCount = 1) {
  const f = await fixture(sellerCount)
  const payouts = await hold(f.orderId)
  const service = createPayoutService({ prisma })
  for (const payout of payouts) await service.reevaluate(payout.id)
  const payoutId = payouts[0]!.id
  const context = await service.paymentContext(payoutId)
  return { ...f, payoutId, payouts, service, pay: {
    payoutId, adminActorId: f.adminId, expectedSnapshot: context.snapshot,
    transferDate: new Date('2026-09-14T12:00:00Z'), transferReference: randomUUID(),
  } }
}

describe('phase 3 payout eligibility', () => {
  it('automatically recovers a bank block after verification', async () => {
    const f = await readyFixture()
    await prisma.sellerBankDetail.updateMany({ where: { sellerId: f.sellerIds[0] }, data: { isVerified: false } })
    const blocked = await f.service.reevaluate(f.payoutId)
    expect(blocked.payout.status).toBe('payout_blocked')
    expect(blocked.payout.manualBlockedAt).toBeNull()
    expect(blocked.automaticReason).toContain('banka')
    expect((await createPayoutRepository(prisma).findReadyForRelease()).map((p) => p.id)).toContain(f.payoutId)
    await prisma.sellerBankDetail.updateMany({ where: { sellerId: f.sellerIds[0] }, data: { isVerified: true } })
    expect((await f.service.reevaluate(f.payoutId)).payout.status).toBe('payout_ready')
  })

  it('retains manual blocks and requires reasoned authorized release without bypassing bank or hold', async () => {
    const f = await readyFixture()
    await f.service.block({ payoutId: f.payoutId, adminActorId: f.adminId, reason: 'Manual review needed' })
    await prisma.sellerBankDetail.updateMany({ where: { sellerId: f.sellerIds[0] }, data: { isVerified: false } })
    const check = await f.service.reevaluate(f.payoutId)
    expect(check.manualReason).toBe('Manual review needed')
    expect(check.automaticReason).toContain('banka')
    await expect(f.service.release({ payoutId: f.payoutId, adminActorId: f.adminId })).rejects.toThrow('açıkça')
    await expect(f.service.release({ payoutId: f.payoutId, adminActorId: f.adminId, clearManualBlock: true })).rejects.toThrow('gerekçesi')
    const seller = await prisma.seller.findUniqueOrThrow({ where: { id: f.sellerIds[0] } })
    await expect(f.service.release({ payoutId: f.payoutId, adminActorId: seller.userId, clearManualBlock: true, reason: 'Review cleared' })).rejects.toThrow()
    const released = await f.service.release({ payoutId: f.payoutId, adminActorId: f.adminId, clearManualBlock: true, reason: 'Review cleared' })
    expect(released.manualBlockedAt).toBeNull()
    expect(released.status).toBe('payout_blocked')
    await prisma.sellerBankDetail.updateMany({ where: { sellerId: f.sellerIds[0] }, data: { isVerified: true } })
    await prisma.order.update({ where: { id: f.orderId }, data: { deliveryConfirmedAt: new Date() } })
    expect((await f.service.reevaluate(f.payoutId)).payout.status).toBe('hold_active')
    await expect(f.service.markPaid(f.pay)).rejects.toThrow()
  })

  it.each(['open', 'under_review'] as const)('rejects payment when a %s dispute opens after the screen was read', async (status) => {
    const f = await readyFixture()
    await prisma.dispute.create({ data: { orderId: f.orderId, openedById: f.adminId, reason: 'New dispute', status } })
    await expect(f.service.markPaid(f.pay)).rejects.toThrow('uyuşmazlık')
    expect(await prisma.sellerLedgerEntry.count({ where: { referenceId: f.payoutId, type: 'payout' } })).toBe(0)
  })

  it('only blocks the affected seller for an escalated return dispute', async () => {
    const f = await readyFixture(2)
    const dispute = await prisma.dispute.create({ data: { orderId: f.orderId, openedById: f.adminId, reason: 'Seller two dispute', status: 'under_review' } })
    await prisma.returnRequest.create({ data: { orderId: f.orderId, customerId: f.adminId, sellerId: f.sellerIds[1], reason: 'Return dispute', status: 'rejected', disputeId: dispute.id, isWithinWindow: true } })
    expect((await f.service.checkReadiness(f.payoutId)).ready).toBe(true)
    expect((await f.service.checkReadiness(f.payouts[1]!.id)).ready).toBe(false)
    await prisma.returnRequest.updateMany({ where: { disputeId: dispute.id }, data: { sellerId: null } })
    expect((await f.service.checkReadiness(f.payoutId)).ready).toBe(false)
    await prisma.dispute.update({ where: { id: dispute.id }, data: { status: 'resolved_for_customer', payoutBlocked: true } })
    expect((await f.service.checkReadiness(f.payoutId)).ready).toBe(false)
  })

  it.each(['amount', 'bank', 'missing'] as const)('rejects a stale or missing payment snapshot: %s', async (change) => {
    const f = await readyFixture()
    if (change === 'amount') await prisma.payout.update({ where: { id: f.payoutId }, data: { netAmount: 700 } })
    if (change === 'bank') await prisma.sellerBankDetail.updateMany({ where: { sellerId: f.sellerIds[0] }, data: { iban: 'TR11111111111111111111111111' } })
    const params = change === 'missing' ? { ...f.pay, expectedSnapshot: undefined } : f.pay
    await expect(f.service.markPaid(params)).rejects.toMatchObject({ code: 'PAYOUT_SNAPSHOT_CHANGED', details: { current: { amount: change === 'amount' ? '700.00' : '820.00' } } })
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: f.payoutId } })).status).toBe('payout_ready')
    const fresh = await f.service.paymentContext(f.payoutId)
    await f.service.markPaid({ ...f.pay, expectedSnapshot: fresh.snapshot })
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: f.payoutId } })).status).toBe('payout_paid')
  })

  it.each(['seller', 'bank', 'pending-bank', 'return', 'refund'] as const)('revalidates %s at payment time', async (blocker) => {
    const f = await readyFixture()
    if (blocker === 'seller') await prisma.seller.update({ where: { id: f.sellerIds[0] }, data: { status: 'suspended' } })
    if (blocker === 'bank') await prisma.sellerBankDetail.updateMany({ where: { sellerId: f.sellerIds[0] }, data: { isVerified: false } })
    if (blocker === 'pending-bank') await prisma.sellerBankDetail.create({ data: { sellerId: f.sellerIds[0]!, iban: 'TR22222222222222222222222222', bankName: 'Changed', accountHolder: 'Test', status: 'PENDING_ACTIVATION' } })
    if (blocker === 'return') await prisma.returnRequest.create({ data: { orderId: f.orderId, sellerId: f.sellerIds[0], customerId: f.adminId, reason: 'New return', isWithinWindow: true } })
    if (blocker === 'refund') await refund(f, 100, randomUUID())
    await expect(f.service.markPaid(f.pay)).rejects.toMatchObject({ code: 'PAYOUT_BLOCKED' })
    expect(await prisma.sellerLedgerEntry.count({ where: { referenceId: f.payoutId, type: 'payout' } })).toBe(0)
  })

  it('keeps batch totals synchronized through concurrent refunds, manual blocks and releases', async () => {
    const f = await readyFixture(2)
    const results = await Promise.all([createReadyPayoutBatch(prisma), createReadyPayoutBatch(prisma)])
    const assigned = await prisma.payout.findUniqueOrThrow({ where: { id: f.payoutId } })
    expect(assigned.batchId).not.toBeNull()
    expect(results.filter((r) => r.batchCreated)).toHaveLength(1)
    const batchId = assigned.batchId!
    const initial = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } })
    // Other fixtures may be ready too; isolate changes relative to the stored total.
    await Promise.all([refund(f, 100, randomUUID()), refund(f, 200, randomUUID())])
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } })).totalAmount.toFixed(2)).toBe(initial.totalAmount.sub(246).toFixed(2))
    await f.service.block({ payoutId: f.payoutId, adminActorId: f.adminId, reason: 'Batch manual review' })
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } })).totalAmount.toFixed(2)).toBe(initial.totalAmount.sub(820).toFixed(2))
    await prisma.refundTransaction.updateMany({ where: { orderId: f.orderId }, data: { status: 'completed' } })
    await f.service.release({ payoutId: f.payoutId, adminActorId: f.adminId, clearManualBlock: true, reason: 'Batch review done' })
    expect((await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } })).totalAmount.toFixed(2)).toBe(initial.totalAmount.sub(246).toFixed(2))
  })

  it('sees a concurrent dispute insert that started before the payment lock', async () => {
    const f = await readyFixture()
    let inserted!: () => void
    let finish!: () => void
    const insertion = new Promise<void>((resolve) => { inserted = resolve })
    const gate = new Promise<void>((resolve) => { finish = resolve })
    const change = prisma.$transaction(async (tx) => {
      await tx.dispute.create({ data: { orderId: f.orderId, openedById: f.adminId, reason: 'Concurrent dispute' } })
      inserted()
      await gate
    })
    await insertion
    const payment = f.service.markPaid(f.pay)
    const result = expect(payment).rejects.toMatchObject({ code: 'PAYOUT_BLOCKED' })
    finish()
    await change
    await result
  })

  it('keeps a resolved customer dispute blocked until its refund is complete', async () => {
    const f = await readyFixture()
    const dispute = await prisma.dispute.create({ data: { orderId: f.orderId, openedById: f.adminId, reason: 'Customer resolution', status: 'resolved_for_customer', payoutBlocked: true } })
    expect((await f.service.checkReadiness(f.payoutId)).ready).toBe(false)
    await createQuantityRefundService({ prisma }).queue({ orderId: f.orderId, sellerId: f.sellerIds[0]!,
      sourceType: 'dispute', sourceId: dispute.id, customerAmount: new Decimal(100),
      grossProductAmount: new Decimal(100), sellerAdjustmentAmount: new Decimal(82), commissionAdjustmentAmount: new Decimal(18),
      items: [{ orderLineId: f.lineIds[0]!, quantity: 1, amount: new Decimal(100) }],
    })
    expect((await f.service.reevaluate(f.payoutId)).ready).toBe(false)
    await prisma.refundTransaction.updateMany({ where: { sourceId: dispute.id }, data: { status: 'completed' } })
    expect((await f.service.reevaluate(f.payoutId)).ready).toBe(true)
  })

  it('releases a completed legacy whole-return dispute without a quantity refund record', async () => {
    const f = await readyFixture()
    const dispute = await prisma.dispute.create({ data: { orderId: f.orderId, openedById: f.adminId,
      reason: 'Legacy customer resolution', status: 'resolved_for_customer', payoutBlocked: true } })
    const returned = await prisma.returnRequest.create({ data: { orderId: f.orderId,
      sellerId: f.sellerIds[0], customerId: f.adminId, reason: 'Legacy return',
      status: 'rejected', disputeId: dispute.id, isWithinWindow: true } })
    expect((await f.service.reevaluate(f.payoutId)).ready).toBe(false)
    await prisma.returnRequest.update({ where: { id: returned.id },
      data: { status: 'refund_completed', refundedAt: new Date() } })
    expect((await f.service.reevaluate(f.payoutId)).ready).toBe(true)
  })

  it('rolls back manual release if its audit fails', async () => {
    const f = await readyFixture()
    await f.service.block({ payoutId: f.payoutId, adminActorId: f.adminId, reason: 'Manual review' })
    const failing = prisma.$extends({ query: { adminAuditLog: { async create() { throw new Error('audit failed') } } } }) as unknown as PrismaClient
    await expect(createPayoutService({ prisma: failing }).release({ payoutId: f.payoutId, adminActorId: f.adminId, clearManualBlock: true, reason: 'Review done' })).rejects.toThrow('audit failed')
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: f.payoutId } })
    expect(payout.status).toBe('payout_blocked')
    expect(payout.manualBlockedReason).toBe('Manual review')
  })

  it('migrates only identifiable automatic blocks and preserves audited or unknown manual blocks', async () => {
    const migration = readFileSync(resolve('../db/schema/migrations/20260914130000_payout_block_sources/migration.sql'), 'utf8')
    await prisma.$transaction(async (tx) => {
      // Transaction-local shadow tables exercise the actual migration without
      // changing the schema used by the other tests or any persistent records.
      await tx.$executeRawUnsafe('CREATE TEMP TABLE payouts (id TEXT, status TEXT, "blockedReason" TEXT, "updatedAt" TIMESTAMP DEFAULT now()) ON COMMIT DROP')
      await tx.$executeRawUnsafe('CREATE TEMP TABLE admin_audit_logs ("targetType" TEXT, "targetId" TEXT, "actionType" TEXT) ON COMMIT DROP')
      await tx.$executeRawUnsafe(`INSERT INTO payouts (id,status,"blockedReason") VALUES
        ('auto','payout_blocked','Doğrulanmış aktif banka hesabı bulunamadı'),
        ('admin','payout_blocked','Doğrulanmış aktif banka hesabı bulunamadı'),
        ('unknown','payout_blocked','Özel inceleme'), ('paid','payout_paid',NULL)`)
      await tx.$executeRawUnsafe(`INSERT INTO admin_audit_logs VALUES ('payout','admin','payout_blocked')`)
      for (const statement of migration.split(';').filter((part) => part.trim())) await tx.$executeRawUnsafe(statement)
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; manualBlockedAt: Date | null; automaticBlockReason: string | null }>>('SELECT id,"manualBlockedAt","automaticBlockReason" FROM payouts')
      expect(rows.find((r) => r.id === 'auto')!.manualBlockedAt).toBeNull()
      expect(rows.find((r) => r.id === 'auto')!.automaticBlockReason).toContain('banka')
      expect(rows.find((r) => r.id === 'admin')!.manualBlockedAt).not.toBeNull()
      expect(rows.find((r) => r.id === 'unknown')!.manualBlockedAt).not.toBeNull()
      expect(rows.find((r) => r.id === 'paid')!.manualBlockedAt).toBeNull()
    })
  })
})

function refund(f: Awaited<ReturnType<typeof fixture>>, amount: number, key: string, client = prisma) {
  return createQuantityRefundService({ prisma: client }).queue({
    orderId: f.orderId, sellerId: f.sellerIds[0]!, sourceType: 'cancellation', sourceId: key,
    customerAmount: new Decimal(amount), grossProductAmount: new Decimal(amount),
    sellerAdjustmentAmount: new Decimal(amount).mul('0.82'),
    commissionAdjustmentAmount: new Decimal(amount).mul('0.18'),
    items: [{ orderLineId: f.lineIds[0]!, quantity: amount / 100, amount: new Decimal(amount) }],
  })
}

describe('finance atomicity on PostgreSQL', () => {
  it('rolls back payout and earlier sale entry when commission insert fails, then retries once', async () => {
    const f = await fixture()
    const failing = prisma.$extends({ query: { sellerLedgerEntry: { async create({ args, query }) {
      if (args.data.type === 'commission') throw new Error('injected commission failure')
      return query(args)
    } } } }) as unknown as PrismaClient
    await expect(hold(f.orderId, failing)).rejects.toThrow('injected commission failure')
    expect(await prisma.payout.count({ where: { orderId: f.orderId } })).toBe(0)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerIds[0] } })).toBe(0)
    await hold(f.orderId)
    await hold(f.orderId)
    expect(await prisma.payout.count({ where: { orderId: f.orderId } })).toBe(1)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerIds[0] } })).toBe(2)
  })

  it('serializes simultaneous activation and locks multiple sellers in a stable order', async () => {
    const f = await fixture(2)
    await Promise.all([hold(f.orderId), hold(f.orderId)])
    expect(await prisma.payout.count({ where: { orderId: f.orderId } })).toBe(2)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: { in: f.sellerIds } } })).toBe(4)
  })

  it('keeps both refund deductions when a second refund starts during the first payout read', async () => {
    const f = await fixture()
    const [payout] = await hold(f.orderId)
    let releaseRead!: () => void
    let observedRead!: () => void
    const gate = new Promise<void>((resolve) => { releaseRead = resolve })
    const read = new Promise<void>((resolve) => { observedRead = resolve })
    const delayed = prisma.$extends({ query: { payout: { async findFirst({ args, query }) {
      const result = await query(args)
      observedRead()
      await gate
      return result
    } } } }) as unknown as PrismaClient
    const first = refund(f, 100, `${f.orderId}-r1`, delayed)
    await read
    const second = refund(f, 200, `${f.orderId}-r2`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    releaseRead()
    await Promise.all([first, second])
    const updated = await prisma.payout.findUniqueOrThrow({ where: { id: payout!.id } })
    expect(updated.netAmount.toFixed(2)).toBe('574.00')
    expect(updated.commissionAmount.toFixed(2)).toBe('126.00')
    expect(updated.refundAmount.toFixed(2)).toBe('300.00')
    const balance = await prisma.sellerLedgerEntry.aggregate({
      where: { sellerId: f.sellerIds[0] }, _sum: { amount: true },
    })
    expect(balance._sum.amount?.toFixed(2)).toBe('574.00')
  })

  it('rolls back refund ledger and markers on payout failure; duplicate requests apply once', async () => {
    const f = await fixture()
    await hold(f.orderId)
    const failing = prisma.$extends({ query: { payout: { async update() {
      throw new Error('injected refund failure')
    } } } }) as unknown as PrismaClient
    await expect(refund(f, 100, f.orderId, failing)).rejects.toThrow('injected refund failure')
    expect(await prisma.refundTransaction.count({ where: { orderId: f.orderId } })).toBe(0)
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.sellerIds[0] } })).toBe(2)
    await Promise.all([refund(f, 100, f.orderId), refund(f, 100, f.orderId)])
    expect(await prisma.refundTransaction.count({ where: { orderId: f.orderId } })).toBe(1)
    const payout = await prisma.payout.findFirstOrThrow({ where: { orderId: f.orderId } })
    expect(payout.netAmount.toFixed(2)).toBe('738.00')
  })

  it('rolls back paid status and ledger when audit fails; retry is idempotent and rejects changed transfer', async () => {
    const f = await fixture()
    const [payout] = await hold(f.orderId)
    await prisma.payout.update({ where: { id: payout!.id }, data: { status: 'payout_ready' } })
    const params = { payoutId: payout!.id, adminActorId: f.adminId,
      transferDate: new Date('2026-03-01T12:00:00Z'), transferReference: 'test-transfer',
      expectedSnapshot: (await createPayoutService({ prisma }).paymentContext(payout!.id)).snapshot }
    const failing = prisma.$extends({ query: { adminAuditLog: { async create() {
      throw new Error('injected audit failure')
    } } } }) as unknown as PrismaClient
    await expect(createPayoutService({ prisma: failing }).markPaid(params)).rejects.toThrow('injected audit failure')
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout!.id } })).status).toBe('payout_ready')
    expect(await prisma.sellerLedgerEntry.count({ where: { referenceId: payout!.id, type: 'payout' } })).toBe(0)
    const service = createPayoutService({ prisma })
    await Promise.all([service.markPaid(params), service.markPaid(params)])
    expect(await prisma.sellerLedgerEntry.count({ where: { referenceId: payout!.id, type: 'payout' } })).toBe(1)
    expect(await prisma.adminAuditLog.count({ where: { targetId: payout!.id } })).toBe(1)
    await expect(service.markPaid({ ...params, transferReference: 'different' })).rejects.toThrow('farklı transfer')
  })

  it('recovers a missing seller payout and commission without changing an existing payout', async () => {
    const f = await fixture(2)
    const existing = await prisma.payout.create({ data: {
      orderId: f.orderId, sellerId: f.sellerIds[0]!, grossAmount: 1000,
      commissionAmount: 180, netAmount: 820, holdStartedAt: confirmedAt,
    } })
    const repository = createPayoutRepository(prisma)
    expect((await repository.findDeliveryConfirmedOrdersMissingPayout()).map((o) => o.id)).toContain(f.orderId)
    await hold(f.orderId)
    expect(await prisma.payout.findUnique({ where: { id: existing.id } })).toEqual(existing)
    expect(await prisma.payout.count({ where: { orderId: f.orderId } })).toBe(2)
    expect((await repository.findDeliveryConfirmedOrdersMissingPayout()).map((o) => o.id)).not.toContain(f.orderId)
  })

  it('recovers missing commission after a full refund reduced the payout commission to zero', async () => {
    const f = await fixture()
    const [payout] = await hold(f.orderId)
    await refund(f, 1000, randomUUID())
    const refunded = await prisma.payout.findUniqueOrThrow({ where: { id: payout!.id } })
    expect(refunded.commissionAmount.toFixed(2)).toBe('0.00')
    await prisma.sellerLedgerEntry.deleteMany({ where: {
      referenceType: 'payout', referenceId: payout!.id, type: 'commission',
    } })
    const repository = createPayoutRepository(prisma)
    expect((await repository.findDeliveryConfirmedOrdersMissingPayout()).map((o) => o.id)).toContain(f.orderId)
    await hold(f.orderId)
    await hold(f.orderId)
    expect(await prisma.payout.findUnique({ where: { id: payout!.id } })).toEqual(refunded)
    const commissions = await prisma.sellerLedgerEntry.findMany({ where: {
      referenceType: 'payout', referenceId: payout!.id, type: 'commission',
    } })
    expect(commissions).toHaveLength(1)
    expect(commissions[0]!.amount.toFixed(2)).toBe('-180.00')
    expect((await repository.findDeliveryConfirmedOrdersMissingPayout()).map((o) => o.id)).not.toContain(f.orderId)
  })

  it('serializes commission exemption with payout creation', async () => {
    const f = await fixture()
    await Promise.allSettled([
      hold(f.orderId),
      createCommissionExemptionService({ prisma }).exempt({
        orderLineId: f.lineIds[0]!, adminActorId: f.adminId, reason: 'Test exemption',
      }),
    ])
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: f.lineIds[0] } })
    const payout = await prisma.payout.findFirstOrThrow({ where: { orderId: f.orderId } })
    expect(payout.commissionAmount.toFixed(2)).toBe(line.commissionExemptedAt ? '0.00' : '180.00')
    expect(payout.netAmount.toFixed(2)).toBe(line.commissionExemptedAt ? '1000.00' : '820.00')
  })
})

describe('phase 2 refund accounting on PostgreSQL', () => {
  it.each(['return_request', 'cancellation', 'dispute'] as const)(
    'applies a pre-payout %s exactly once across hold and refund retries',
    async (sourceType) => {
      const f = await fixture(2)
      const line = await prisma.orderLine.findUniqueOrThrow({
        where: { id: f.lineIds[0] },
      })
      const amounts = allocateProductRefund(line, 0, 10)
      const args = {
        orderId: f.orderId,
        sellerId: f.sellerIds[0]!,
        sourceType,
        sourceId: randomUUID(),
        customerAmount: amounts.customerAmount,
        grossProductAmount: amounts.grossAmount,
        couponAdjustmentAmount: amounts.couponAmount,
        commissionAdjustmentAmount: amounts.commissionAmount,
        sellerAdjustmentAmount: amounts.sellerAmount,
        items: [
          {
            orderLineId: line.id,
            quantity: 10,
            amount: amounts.customerAmount,
          },
        ],
      }
      const service = createQuantityRefundService({ prisma })
      await service.queue(args)
      await hold(f.orderId)
      await service.queue(args)
      await hold(f.orderId)
      const payouts = await prisma.payout.findMany({
        where: { orderId: f.orderId },
      })
      expect(payouts.find((p) => p.sellerId === f.sellerIds[0])!.netAmount.toFixed(2)).toBe('0.00')
      expect(payouts.find((p) => p.sellerId === f.sellerIds[1])!.netAmount.toFixed(2)).toBe(
        '820.00',
      )
      const balance = await prisma.sellerLedgerEntry.aggregate({
        where: { sellerId: f.sellerIds[0] },
        _sum: { amount: true },
      })
      expect(balance._sum.amount!.toFixed(2)).toBe('0.00')
      const stored = await prisma.refundTransaction.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType, sourceId: args.sourceId } },
      })
      expect(stored.payoutAppliedAt).not.toBeNull()
    },
  )

  it.each([true, false])(
    'full exempt cancellation leaves zero payout (before hold: %s)',
    async (beforeHold) => {
      const f = await fixture()
      await createCommissionExemptionService({ prisma }).exempt({
        orderLineId: f.lineIds[0]!,
        adminActorId: f.adminId,
        reason: 'Phase 2 test',
      })
      if (!beforeHold) await hold(f.orderId)
      const service = createQuantityCancellationService({ prisma })
      const args = {
        orderId: f.orderId,
        customerId: f.adminId,
        reason: 'Phase 2 cancellation',
        idempotencyKey: randomUUID(),
        items: [{ orderLineId: f.lineIds[0]!, quantity: 10 }],
      }
      const [operation] = await service.create(args)
      expect(operation!.sellerAdjustmentAmount.toFixed(2)).toBe('1000.00')
      expect(operation!.commissionAdjustmentAmount.toFixed(2)).toBe('0.00')
      await hold(f.orderId)
      await service.create(args)
      const payout = await prisma.payout.findFirstOrThrow({
        where: { orderId: f.orderId },
      })
      expect(payout.netAmount.toFixed(2)).toBe('0.00')
      const line = await prisma.orderLine.findUniqueOrThrow({
        where: { id: f.lineIds[0] },
      })
      expect(line.commissionAmount.toFixed(2)).toBe('180.00')
      expect(line.netPayoutAmount.toFixed(2)).toBe('820.00')
    },
  )
})

describe('phase 2 quantity lifecycle', () => {
  it.each([
    { exempt: false, paid: '94.99', method: 'eft' as const },
    { exempt: true, paid: '94.99', method: 'eft' as const },
    { exempt: false, paid: '89.99', method: 'card' as const },
    { exempt: true, paid: '0.00', method: 'eft' as const },
  ])(
    'cancellation, accepted return and dispute reconcile: %j',
    async ({ exempt, paid, method }) => {
      const f = await fixture(2)
      const lineId = f.lineIds[0]!
      await prisma.orderLine.update({
        where: { id: lineId },
        data: {
          quantity: 3,
          unitPrice: '33.3333',
          totalPrice: '100',
          couponDiscountAmount: '0.01',
          commissionAmount: '18.01',
          netPayoutAmount: '81.98',
          customerPaidProductAmount: paid,
          deliveryConfirmedAt: new Date(),
          ...(exempt ? { commissionExemptedAt: new Date() } : {}),
        },
      })
      await prisma.payment.updateMany({
        where: { orderId: f.orderId },
        data: { method, provider: method === 'card' ? 'iyzico' : 'manual_eft' },
      })
      const cancellations = createQuantityCancellationService({ prisma })
      await cancellations.create({
        orderId: f.orderId,
        customerId: f.adminId,
        reason: 'One unit cancellation',
        items: [{ orderLineId: lineId, quantity: 1 }],
      })
      await prisma.orderLine.update({
        where: { id: lineId },
        data: { shippedQuantity: 2 },
      })
      const returns = createQuantityReturnService({ prisma })
      const [request] = await returns.openRequest({
        orderId: f.orderId,
        customerId: f.adminId,
        reason: 'Return remaining units',
        items: [{ orderLineId: lineId, quantity: 2 }],
      })
      await prisma.returnRequest.update({
        where: { id: request!.id },
        data: { status: 'in_transit' },
      })
      const decision = {
        returnRequestId: request!.id,
        sellerId: f.sellerIds[0]!,
        decisions: [
          {
            returnRequestItemId: request!.items[0]!.id,
            acceptedQuantity: 1,
            rejectedQuantity: 1,
            rejectionReason: 'Disputed unit condition',
          },
        ],
      }
      await returns.decideReceipt(decision)
      await returns.decideReceipt(decision)
      // Payout is created between accepted return and dispute resolution.
      await hold(f.orderId)
      const rr = await prisma.returnRequest.findUniqueOrThrow({
        where: { id: request!.id },
      })
      await createDisputeService({ prisma }).resolveDispute({
        disputeId: rr.disputeId!,
        adminActorId: f.adminId,
        resolutionType: 'resolved_for_customer',
        resolution: 'Refund remaining unit',
      })
      await hold(f.orderId)
      const payouts = await prisma.payout.findMany({
        where: { orderId: f.orderId },
      })
      const own = payouts.find((p) => p.sellerId === f.sellerIds[0])!
      expect(own.netAmount.toFixed(2)).toBe('0.00')
      expect(own.refundAmount.toFixed(2)).toBe('100.00')
      expect(own.commissionAmount.toFixed(2)).toBe('0.00')
      expect(own.couponShareAmount.toFixed(2)).toBe('0.00')
      expect(payouts.find((p) => p.sellerId === f.sellerIds[1])!.netAmount.toFixed(2)).toBe(
        '820.00',
      )
      const refunds = await prisma.refundTransaction.findMany({
        where: { orderId: f.orderId, sellerId: f.sellerIds[0] },
      })
      expect(refunds).toHaveLength(3)
      expect(refunds.reduce((sum, r) => sum.add(r.customerAmount), new Decimal(0)).toFixed(2)).toBe(
        paid,
      )
      expect(
        refunds.reduce((sum, r) => sum.add(r.sellerAdjustmentAmount), new Decimal(0)).toFixed(2),
      ).toBe(exempt ? '99.99' : '81.98')
      const balance = await prisma.sellerLedgerEntry.aggregate({
        where: { sellerId: f.sellerIds[0] },
        _sum: { amount: true },
      })
      expect(balance._sum.amount!.toFixed(2)).toBe('0.00')
    },
  )
})


describe('phase 2 full exempt return', () => {
  it.each([true, false])('leaves zero payout for a 1000 TRY return (before hold: %s)', async (beforeHold) => {
    const f = await fixture()
    const lineId = f.lineIds[0]!
    await createCommissionExemptionService({ prisma }).exempt({ orderLineId: lineId, adminActorId: f.adminId, reason: 'Exempt full return' })
    await prisma.orderLine.update({ where: { id: lineId }, data: { shippedQuantity: 10, deliveryConfirmedAt: new Date() } })
    if (!beforeHold) await hold(f.orderId)
    const returns = createQuantityReturnService({ prisma })
    const [request] = await returns.openRequest({ orderId: f.orderId, customerId: f.adminId, reason: 'Full return', items: [{ orderLineId: lineId, quantity: 10 }] })
    await prisma.returnRequest.update({ where: { id: request!.id }, data: { status: 'in_transit' } })
    const decision = { returnRequestId: request!.id, sellerId: f.sellerIds[0]!, decisions: [{ returnRequestItemId: request!.items[0]!.id, acceptedQuantity: 10, rejectedQuantity: 0 }] }
    await returns.decideReceipt(decision)
    if (beforeHold) {
      const failing = prisma.$extends({ query: { refundTransaction: { async updateMany({ args, query }) {
        if (args.data.payoutAppliedAt) throw new Error('injected refund marker failure')
        return query(args)
      } } } }) as unknown as PrismaClient
      await expect(hold(f.orderId, failing)).rejects.toThrow('injected refund marker failure')
      expect(await prisma.payout.count({ where: { orderId: f.orderId } })).toBe(0)
      const pending = await prisma.refundTransaction.findFirstOrThrow({ where: { orderId: f.orderId } })
      expect(pending.payoutAppliedAt).toBeNull()
    }
    await hold(f.orderId)
    await returns.decideReceipt(decision)
    await hold(f.orderId)
    const payout = await prisma.payout.findFirstOrThrow({ where: { orderId: f.orderId } })
    expect(payout.netAmount.toFixed(2)).toBe('0.00')
    expect(payout.commissionAmount.toFixed(2)).toBe('0.00')
    expect(payout.refundAmount.toFixed(2)).toBe('1000.00')
    const refund = await prisma.refundTransaction.findFirstOrThrow({ where: { orderId: f.orderId } })
    expect(refund.sellerAdjustmentAmount.toFixed(2)).toBe('1000.00')
    expect(refund.commissionAdjustmentAmount.toFixed(2)).toBe('0.00')
    expect(await prisma.refundTransaction.count({ where: { orderId: f.orderId } })).toBe(1)
  })
})
