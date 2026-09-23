/**
 * Product questions against a real PostgreSQL database: the uniqueness of a
 * conversation and the "one e-mail per turn" rule must hold when requests race,
 * which a mocked client cannot show (row locks, unique index, READ COMMITTED).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

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
const schema = `product_q_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
url.searchParams.set('connection_limit', '10')
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

import {
  appendProductQuestionMessage,
  createProductQuestionService,
} from '../../api/services/product-question.service'

const service = () => createProductQuestionService({ prisma })

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
  if (!/^product_q_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

afterEach(async () => {
  await prisma.notificationOutbox.deleteMany({})
})

interface Fixture {
  customerId: string
  sellerId: string
  sellerUserId: string
  productId: string
  orderId: string
}

async function seed(): Promise<Fixture> {
  const suffix = randomUUID()
  const customer = await prisma.user.create({
    data: { email: `c-${suffix}@example.test`, name: 'Ayşe Yılmaz', role: 'customer' },
  })
  const sellerUser = await prisma.user.create({
    data: { email: `s-${suffix}@example.test`, name: 'Satıcı', role: 'seller' },
  })
  const seller = await prisma.seller.create({
    data: {
      userId: sellerUser.id,
      slug: `atelier-${suffix.slice(0, 8)}`,
      displayName: 'Atelier Noa',
      status: 'active',
    },
  })
  const product = await prisma.product.create({
    data: {
      sellerId: seller.id,
      slug: `urun-${suffix.slice(0, 8)}`,
      name: 'Gea Berjer',
      status: 'published',
      price: new Decimal('100.00'),
      stockQuantity: 5,
    },
  })
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      status: 'payment_confirmed',
      paymentConfirmedAt: new Date(),
      grossAmount: new Decimal('100.00'),
      totalAmount: new Decimal('100.00'),
      lines: {
        create: {
          productId: product.id,
          sellerId: seller.id,
          productName: 'Gea Berjer',
          quantity: 1,
          unitPrice: new Decimal('100.00'),
          totalPrice: new Decimal('100.00'),
          customerPaidProductAmount: new Decimal('100.00'),
          netPayoutAmount: new Decimal('100.00'),
        },
      },
    },
  })
  return {
    customerId: customer.id,
    sellerId: seller.id,
    sellerUserId: sellerUser.id,
    productId: product.id,
    orderId: order.id,
  }
}

function outboxOf(type: string, userId: string) {
  return prisma.notificationOutbox.findMany({ where: { type, userId } })
}

describe('product questions — PostgreSQL concurrency', () => {
  it('two simultaneous first questions open one conversation with one seller e-mail', async () => {
    const f = await seed()
    const ask = (body: string) =>
      service().askQuestion({ customerId: f.customerId, customerRole: 'customer', productId: f.productId, body })

    const results = await Promise.all([ask('Ölçüleri nedir?'), ask('Rengi nasıl?')])

    expect(new Set(results.map((r) => r.threadId)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    const threads = await prisma.productQuestionThread.findMany({ where: { customerId: f.customerId } })
    expect(threads).toHaveLength(1)
    expect(await prisma.productQuestionMessage.count({ where: { threadId: threads[0]!.id } })).toBe(2)
    const outbox = await outboxOf('seller_product_question', f.sellerUserId)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.eventKey).toBe(`product-question:${threads[0]!.id}:seller:turn:1`)
  })

  it('parallel customer messages after a seller reply produce one e-mail and one turn', async () => {
    const f = await seed()
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'Stokta var mı?',
    })
    await service().replyAsSeller({
      threadId,
      sellerId: f.sellerId,
      authorUserId: f.sellerUserId,
      body: 'Evet, stokta var.',
    })
    await prisma.notificationOutbox.deleteMany({})

    await Promise.all(
      ['Teşekkürler.', 'Kargo süresi ne kadar?', 'Bir de renk seçeneği var mı?'].map((body) =>
        service().replyAsCustomer({ threadId, customerId: f.customerId, body }),
      ),
    )

    const thread = await prisma.productQuestionThread.findUniqueOrThrow({ where: { id: threadId } })
    expect(thread.status).toBe('waiting_for_seller')
    expect(thread.turnSeq).toBe(3)
    const outbox = await outboxOf('seller_product_question', f.sellerUserId)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.eventKey).toBe(`product-question:${threadId}:seller:turn:3`)
  })

  it('parallel seller replies produce one customer e-mail', async () => {
    const f = await seed()
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'Montaj gerekiyor mu?',
    })

    await Promise.all(
      ['Hayır, kurulu gelir.', 'Ek olarak ayak takımı da dahil.'].map((body) =>
        service().replyAsSeller({ threadId, sellerId: f.sellerId, authorUserId: f.sellerUserId, body }),
      ),
    )

    const outbox = await outboxOf('customer_product_question_answered', f.customerId)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.eventKey).toBe(`product-question:${threadId}:customer:turn:2`)
  })

  it('keeps pre-sale and order-linked conversations for the same product apart', async () => {
    const f = await seed()
    const presale = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'Satın almadan önce sormak istiyorum.',
    })
    const ordered = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      orderId: f.orderId,
      body: 'Siparişim ne zaman kargoya verilir?',
    })
    expect(presale.threadId).not.toBe(ordered.threadId)
    const orderedThread = await prisma.productQuestionThread.findUniqueOrThrow({
      where: { id: ordered.threadId },
    })
    expect(orderedThread.orderId).toBe(f.orderId)
    expect(orderedThread.threadKey).toBe(`${f.customerId}:${f.productId}:${f.orderId}`)
  })

  it('rolls the conversation back when the outbox write fails', async () => {
    const f = await seed()
    const failingOutbox = prisma.$extends({
      query: {
        notificationOutbox: {
          upsert() {
            throw new Error('outbox unavailable')
          },
        },
      },
    }) as unknown as PrismaClient
    await expect(
      createProductQuestionService({ prisma: failingOutbox }).askQuestion({
        customerId: f.customerId,
        customerRole: 'customer',
        productId: f.productId,
        body: 'Bu soru kaydedilmemeli.',
      }),
    ).rejects.toThrow('outbox unavailable')
    expect(await prisma.productQuestionThread.count({ where: { customerId: f.customerId } })).toBe(0)
    expect(await prisma.productQuestionMessage.count({ where: { authorId: f.customerId } })).toBe(0)
  })

  it('moves the read boundary forward only, to a message of the same thread', async () => {
    const f = await seed()
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'İlk soru',
    })
    await service().replyAsCustomer({ threadId, customerId: f.customerId, body: 'İkinci soru' })
    const messages = await prisma.productQuestionMessage.findMany({
      where: { threadId },
      orderBy: { seq: 'asc' },
    })
    expect(messages.map((m) => m.seq)).toEqual([1, 2])
    const [first, last] = [messages[0]!, messages[1]!]

    expect(await service().countUnreadForSeller(f.sellerId)).toBe(1)
    await service().markRead(threadId, { role: 'seller', sellerId: f.sellerId }, last.id)
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(0)
    const advanced = await service().markRead(threadId, { role: 'seller', sellerId: f.sellerId }, first.id)
    expect(advanced.advanced).toBe(false)
    const thread = await prisma.productQuestionThread.findUniqueOrThrow({ where: { id: threadId } })
    expect(thread.sellerLastReadSeq).toBe(2)

    const other = await seed()
    const otherThread = await service().askQuestion({
      customerId: other.customerId,
      customerRole: 'customer',
      productId: other.productId,
      body: 'Başka konuşma',
    })
    const foreign = await prisma.productQuestionMessage.findFirstOrThrow({
      where: { threadId: otherThread.threadId },
    })
    await expect(
      service().markRead(threadId, { role: 'seller', sellerId: f.sellerId }, foreign.id),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('orders messages by lock acquisition when an earlier request completes later, and a read in between keeps the new message unread', async () => {
    const f = await seed()
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'Görünen ilk mesaj',
    })
    const visible = await prisma.productQuestionMessage.findFirstOrThrow({ where: { threadId } })

    let releaseA!: () => void
    const gate = new Promise<void>((resolve) => (releaseA = resolve))
    let signalLocked!: () => void
    const aHoldsLock = new Promise<void>((resolve) => (signalLocked = resolve))

    // A takes the thread lock and stays uncommitted until the gate opens.
    const a = prisma.$transaction(
      async (tx) => {
        const result = await appendProductQuestionMessage(tx, {
          threadId,
          author: 'customer',
          authorId: f.customerId,
          body: 'A — kilidi ilk alan',
        })
        signalLocked()
        await gate
        return result
      },
      { timeout: 15_000 },
    )
    await aHoldsLock

    // While A is uncommitted: B starts writing and the seller reads the last visible message.
    let bSettled = false
    const b = service()
      .replyAsCustomer({ threadId, customerId: f.customerId, body: 'B — sonra başlayan' })
      .finally(() => {
        bSettled = true
      })
    const read = service().markRead(threadId, { role: 'seller', sellerId: f.sellerId }, visible.id)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(bSettled).toBe(false)

    releaseA()
    const [ra, rb] = await Promise.all([a, b, read])

    expect(ra.seq).toBe(2)
    expect(rb.seq).toBe(3)
    const thread = await prisma.productQuestionThread.findUniqueOrThrow({ where: { id: threadId } })
    expect(thread.messageSeq).toBe(3)
    expect(thread.lastCustomerMessageSeq).toBe(3)
    expect(thread.sellerLastReadSeq).toBe(1)
    const messages = await prisma.productQuestionMessage.findMany({
      where: { threadId },
      orderBy: { seq: 'asc' },
    })
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3])
    for (let i = 1; i < messages.length; i += 1) {
      expect(messages[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(messages[i - 1]!.createdAt.getTime())
    }
    expect(thread.lastMessageAt.getTime()).toBe(messages[2]!.createdAt.getTime())

    // The messages written behind the read stay unread until the one shown last is reported.
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(1)
    await service().markRead(threadId, { role: 'seller', sellerId: f.sellerId }, messages[1]!.id)
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(1)
    await service().markRead(threadId, { role: 'seller', sellerId: f.sellerId }, messages[2]!.id)
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(0)
  })

  it('pages past 100 conversations so the oldest stays reachable', async () => {
    const f = await seed()
    const base = Date.now() - 1_000_000
    await prisma.productQuestionThread.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        threadKey: `${f.customerId}:${f.productId}:bulk-${index}`,
        customerId: f.customerId,
        sellerId: f.sellerId,
        productId: f.productId,
        lastMessageAt: new Date(base + index * 1000),
      })),
    })
    const oldest = await prisma.productQuestionThread.findFirstOrThrow({
      where: { threadKey: `${f.customerId}:${f.productId}:bulk-0` },
    })

    const first = await service().listForSeller(f.sellerId, { page: 1 })
    expect(first).toMatchObject({ total: 101, page: 1, totalPages: 4 })
    expect(first.items).toHaveLength(30)
    const last = await service().listForSeller(f.sellerId, { page: 4 })
    expect(last.items).toHaveLength(11)
    expect(last.items.at(-1)!.id).toBe(oldest.id)
    const clamped = await service().listForSeller(f.sellerId, { page: 99 })
    expect(clamped.page).toBe(4)

    const allIds = new Set<string>()
    for (let page = 1; page <= 4; page += 1) {
      for (const item of (await service().listForSeller(f.sellerId, { page })).items) allIds.add(item.id)
    }
    expect(allIds.size).toBe(101)

    const customerPages = await service().listForCustomer(f.customerId, { page: 4 })
    expect(customerPages.items.map((item) => item.id)).toContain(oldest.id)
  })
})
