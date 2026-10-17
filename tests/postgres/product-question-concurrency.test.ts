/**
 * Product questions against a real PostgreSQL database: the uniqueness of a
 * conversation, the notifications and the read boundaries must hold when
 * requests race, which a mocked client cannot show (row locks, unique index,
 * READ COMMITTED).
 *
 * Hanuja is the seller of record (docs/07-operations/hanuja-seller-model.md):
 * customer and designer never write to each other. Each of their messages gives
 * every admin one in-app copy in its own turn; only a Hanuja reply reaches the
 * customer or the designer, by e-mail and as an unread message.
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
  customerEmail: string
  sellerId: string
  sellerUserId: string
  adminId: string
  productId: string
  orderId: string
}

async function seed(): Promise<Fixture> {
  const suffix = randomUUID()
  const customer = await prisma.user.create({
    data: { email: `c-${suffix}@example.test`, name: 'Ayşe Yılmaz', role: 'customer' },
  })
  const sellerUser = await prisma.user.create({
    data: { email: `s-${suffix}@example.test`, name: 'Tasarımcı', role: 'seller' },
  })
  // Hanuja staff: the recipient of every customer and designer message.
  const admin = await prisma.user.create({
    data: { email: `a-${suffix}@example.test`, name: 'Hanuja Operasyon', role: 'admin' },
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
    customerEmail: customer.email,
    sellerId: seller.id,
    sellerUserId: sellerUser.id,
    adminId: admin.id,
    productId: product.id,
    orderId: order.id,
  }
}

function outboxOf(type: string, userId: string) {
  return prisma.notificationOutbox.findMany({ where: { type, userId } })
}

/** Event keys of the in-app copies one admin got for a thread; admins of other fixtures are ignored. */
async function staffEventKeys(threadId: string, adminId: string) {
  const rows = await prisma.notificationOutbox.findMany({
    where: {
      type: 'admin_support_new_ticket',
      userId: adminId,
      eventKey: { startsWith: `product-question:${threadId}:` },
    },
  })
  // Staff copies are in-app only.
  for (const row of rows) expect((row.payload as { emailTo?: string }).emailTo).toBeUndefined()
  return rows.map((row) => row.eventKey).sort()
}

function staffEventKey(
  threadId: string,
  adminId: string,
  turn: number,
  author: 'customer' | 'seller',
) {
  return `product-question:${threadId}:admin:${adminId}:turn:${turn}:${author}`
}

describe('product questions — PostgreSQL concurrency', () => {
  it('two simultaneous first questions open one conversation; staff get one copy per message, the designer nothing', async () => {
    const f = await seed()
    const ask = (body: string) =>
      service().askQuestion({ customerId: f.customerId, customerRole: 'customer', productId: f.productId, body })

    const results = await Promise.all([ask('Ölçüleri nedir?'), ask('Rengi nasıl?')])

    expect(new Set(results.map((r) => r.threadId)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    const threads = await prisma.productQuestionThread.findMany({ where: { customerId: f.customerId } })
    expect(threads).toHaveLength(1)
    const threadId = threads[0]!.id
    expect(await prisma.productQuestionMessage.count({ where: { threadId } })).toBe(2)
    // The opener is turn 1 and the request that lost the race joins as turn 2: no copy is lost or doubled.
    expect(await staffEventKeys(threadId, f.adminId)).toEqual([
      staffEventKey(threadId, f.adminId, 1, 'customer'),
      staffEventKey(threadId, f.adminId, 2, 'customer'),
    ])
    expect(await prisma.notificationOutbox.count({ where: { userId: f.sellerUserId } })).toBe(0)
  })

  it('parallel customer messages after a designer reply reach staff once each, in their own turns', async () => {
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
    // "waiting_for_seller" is waiting for Hanuja, the seller of record.
    expect(thread.status).toBe('waiting_for_seller')
    expect(thread.messageSeq).toBe(5)
    expect(thread.turnSeq).toBe(5)
    // Turns are taken under the row lock; two writers sharing a turn would collapse into one copy.
    expect(await staffEventKeys(threadId, f.adminId)).toEqual(
      [3, 4, 5].map((turn) => staffEventKey(threadId, f.adminId, turn, 'customer')),
    )
    const messages = await prisma.productQuestionMessage.findMany({
      where: { threadId },
      orderBy: { seq: 'asc' },
    })
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    for (let i = 1; i < messages.length; i += 1) {
      expect(messages[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(messages[i - 1]!.createdAt.getTime())
    }
    expect(thread.lastMessageAt.getTime()).toBe(messages[4]!.createdAt.getTime())
    // Customer messages are not addressed to the designer.
    expect(await prisma.notificationOutbox.count({ where: { userId: f.sellerUserId } })).toBe(0)
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(0)
  })

  it('parallel designer replies stay internal: staff get one copy each, the customer nothing', async () => {
    const f = await seed()
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'Montaj gerekiyor mu?',
    })
    await prisma.notificationOutbox.deleteMany({})

    await Promise.all(
      ['Hayır, kurulu gelir.', 'Ek olarak ayak takımı da dahil.'].map((body) =>
        service().replyAsSeller({ threadId, sellerId: f.sellerId, authorUserId: f.sellerUserId, body }),
      ),
    )

    expect(await staffEventKeys(threadId, f.adminId)).toEqual(
      [2, 3].map((turn) => staffEventKey(threadId, f.adminId, turn, 'seller')),
    )
    expect(await prisma.notificationOutbox.count({ where: { userId: f.customerId } })).toBe(0)
    const customerView = await service().getForCustomer(threadId, f.customerId)
    expect(customerView!.messages.map((m) => m.body)).toEqual(['Montaj gerekiyor mu?'])
    const [listed] = (await service().listForCustomer(f.customerId)).items
    expect(listed!.unread).toBe(false)
  })

  it('parallel Hanuja replies e-mail the customer once each and leave the newest one unread', async () => {
    const f = await seed()
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'Montaj gerekiyor mu?',
    })

    const replies = await Promise.all(
      ['Hayır, kurulu gelir.', 'Ek olarak ayak takımı da dahil.'].map((body) =>
        service().replyAsAdmin({ threadId, adminId: f.adminId, audience: 'customer', body }),
      ),
    )

    expect(replies.map((m) => m.seq).sort((x, y) => x - y)).toEqual([2, 3])
    const emails = await outboxOf('customer_product_question_answered', f.customerId)
    expect(emails.map((row) => row.eventKey).sort()).toEqual(
      replies.map((m) => `product-question:${threadId}:admin-reply:${m.id}`).sort(),
    )
    for (const row of emails) {
      expect((row.payload as { emailTo?: string }).emailTo).toBe(f.customerEmail)
    }
    const thread = await prisma.productQuestionThread.findUniqueOrThrow({ where: { id: threadId } })
    expect(thread.status).toBe('waiting_for_customer')
    // The customer's unread marker is the last Hanuja message addressed to them.
    expect(thread.lastSellerMessageSeq).toBe(3)
    expect(await prisma.notificationOutbox.count({ where: { userId: f.sellerUserId } })).toBe(0)
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
    // The seeded admin is the recipient whose outbox row fails here.
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

  it('moves the read boundary forward only, to a message of the same thread addressed to the viewer', async () => {
    const f = await seed()
    const designer = { role: 'seller' as const, sellerId: f.sellerId }
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'İlk soru',
    })
    await service().replyAsCustomer({ threadId, customerId: f.customerId, body: 'İkinci soru' })
    // Customer messages are never unread for the designer, nor can the designer report them as read.
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(0)
    const customerMessage = await prisma.productQuestionMessage.findFirstOrThrow({
      where: { threadId, seq: 1 },
    })
    await expect(service().markRead(threadId, designer, customerMessage.id)).rejects.toMatchObject({
      statusCode: 404,
    })

    for (const body of ['Ölçüleri iletir misiniz?', 'Renk seçeneklerini de ekleyin.']) {
      await service().replyAsAdmin({ threadId, adminId: f.adminId, audience: 'seller', body })
    }
    const messages = await prisma.productQuestionMessage.findMany({
      where: { threadId, audience: 'seller' },
      orderBy: { seq: 'asc' },
    })
    expect(messages.map((m) => m.seq)).toEqual([3, 4])
    const [first, last] = [messages[0]!, messages[1]!]

    expect(await service().countUnreadForSeller(f.sellerId)).toBe(1)
    await service().markRead(threadId, designer, last.id)
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(0)
    const advanced = await service().markRead(threadId, designer, first.id)
    expect(advanced.advanced).toBe(false)
    const thread = await prisma.productQuestionThread.findUniqueOrThrow({ where: { id: threadId } })
    expect(thread.sellerLastReadSeq).toBe(4)

    const other = await seed()
    const otherThread = await service().askQuestion({
      customerId: other.customerId,
      customerRole: 'customer',
      productId: other.productId,
      body: 'Başka konuşma',
    })
    await service().replyAsAdmin({
      threadId: otherThread.threadId,
      adminId: other.adminId,
      audience: 'seller',
      body: 'Başka tasarımcıya not',
    })
    // Addressed to a designer, but in another thread.
    const foreign = await prisma.productQuestionMessage.findFirstOrThrow({
      where: { threadId: otherThread.threadId, audience: 'seller' },
    })
    await expect(service().markRead(threadId, designer, foreign.id)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('orders messages by lock acquisition when an earlier request completes later, and a read in between keeps the new message unread', async () => {
    const f = await seed()
    const designer = { role: 'seller' as const, sellerId: f.sellerId }
    const { threadId } = await service().askQuestion({
      customerId: f.customerId,
      customerRole: 'customer',
      productId: f.productId,
      body: 'Müşterinin sorusu',
    })
    await service().replyAsAdmin({
      threadId,
      adminId: f.adminId,
      audience: 'seller',
      body: 'Görünen ilk mesaj',
    })
    const visible = await prisma.productQuestionMessage.findFirstOrThrow({
      where: { threadId, audience: 'seller' },
    })

    let releaseA!: () => void
    const gate = new Promise<void>((resolve) => (releaseA = resolve))
    let signalLocked!: () => void
    const aHoldsLock = new Promise<void>((resolve) => (signalLocked = resolve))

    // A (the designer's answer) takes the thread lock and stays uncommitted until the gate opens.
    const a = prisma.$transaction(
      async (tx) => {
        const result = await appendProductQuestionMessage(tx, {
          threadId,
          author: 'seller',
          authorId: f.sellerUserId,
          body: 'A — kilidi ilk alan',
        })
        signalLocked()
        await gate
        return result
      },
      { timeout: 15_000 },
    )
    await aHoldsLock

    // While A is uncommitted: Hanuja starts a message to the designer and the designer reads the last visible one.
    let bSettled = false
    const b = service()
      .replyAsAdmin({ threadId, adminId: f.adminId, audience: 'seller', body: 'B — sonra başlayan' })
      .finally(() => {
        bSettled = true
      })
    const read = service().markRead(threadId, designer, visible.id)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(bSettled).toBe(false)

    releaseA()
    const [ra, rb] = await Promise.all([a, b, read])

    expect(ra.seq).toBe(3)
    expect(rb.seq).toBe(4)
    const thread = await prisma.productQuestionThread.findUniqueOrThrow({ where: { id: threadId } })
    expect(thread.messageSeq).toBe(4)
    // The designer's unread marker is the last Hanuja message addressed to them.
    expect(thread.lastCustomerMessageSeq).toBe(4)
    expect(thread.sellerLastReadSeq).toBe(2)
    const messages = await prisma.productQuestionMessage.findMany({
      where: { threadId },
      orderBy: { seq: 'asc' },
    })
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3, 4])

    // The messages written behind the read stay unread until the one shown last is reported.
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(1)
    await service().markRead(threadId, designer, messages[2]!.id)
    expect(await service().countUnreadForSeller(f.sellerId)).toBe(1)
    await service().markRead(threadId, designer, messages[3]!.id)
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
