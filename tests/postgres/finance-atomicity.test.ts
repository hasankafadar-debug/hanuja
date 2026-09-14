import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
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
      transferDate: new Date('2026-03-01T12:00:00Z'), transferReference: 'test-transfer' }
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
