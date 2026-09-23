import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProductQuestionService } from '../../../api/services/product-question.service'

const NOTIFY_THREAD = {
  id: 't1',
  turnSeq: 2,
  customerId: 'c1',
  customer: { id: 'c1', name: 'Ayşe Yılmaz', email: 'ayse@example.test' },
  seller: { id: 's1', displayName: 'Atelier Noa', userId: 'su1', user: { email: 'seller@example.test' } },
  product: { name: 'Gea Berjer', images: [] },
  order: null,
}

function makePrisma() {
  // Status seen under the row lock (first update of appendProductQuestionMessage).
  const state = { lockStatus: 'waiting_for_seller' as 'waiting_for_seller' | 'waiting_for_customer' }
  const tx = {
    productQuestionThread: {
      create: vi.fn().mockResolvedValue({ id: 't1' }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        data.messageSeq
          ? { messageSeq: 2, status: state.lockStatus, lastMessageAt: new Date(0) }
          : NOTIFY_THREAD,
      ),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...NOTIFY_THREAD, turnSeq: 1 }),
    },
    productQuestionMessage: {
      create: vi.fn().mockResolvedValue({ id: 'm1', createdAt: new Date() }),
    },
    notificationOutbox: { upsert: vi.fn().mockResolvedValue({ id: 'o1' }) },
  }
  const prisma = {
    product: {
      findUnique: vi.fn().mockResolvedValue({
        status: 'published',
        sellerId: 's1',
        seller: { status: 'active', vacationModeEnabled: false, userId: 'su1' },
      }),
    },
    order: {
      findFirst: vi.fn().mockResolvedValue({
        paymentConfirmedAt: new Date(),
        lines: [{ sellerId: 's-line', seller: { status: 'active', userId: 'su1' } }],
      }),
    },
    productQuestionThread: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue({ id: 't1', seller: { status: 'active' } }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      fields: { sellerLastReadSeq: 'sellerLastReadSeq' },
    },
    productQuestionMessage: {
      findFirst: vi.fn().mockResolvedValue({ seq: 5 }),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  }
  return { prisma, tx, state }
}

type Mocked = ReturnType<typeof makePrisma>

let m: Mocked
const svc = () => createProductQuestionService({ prisma: m.prisma as never })

const ask = (overrides: Record<string, unknown> = {}) =>
  svc().askQuestion({
    customerId: 'c1',
    customerRole: 'customer',
    productId: 'p1',
    body: 'Ölçüleri nedir?',
    ...overrides,
  })

beforeEach(() => {
  m = makePrisma()
})

describe('message body gate — the same for all three write paths', () => {
  const writePaths: Array<[string, (body: string) => Promise<unknown>]> = [
    ['question', (body) => ask({ body })],
    ['customer reply', (body) => svc().replyAsCustomer({ threadId: 't1', customerId: 'c1', body })],
    [
      'seller reply',
      (body) => svc().replyAsSeller({ threadId: 't1', sellerId: 's1', authorUserId: 'su1', body }),
    ],
  ]

  it.each(writePaths)('%s rejects contact details, too-short and too-long text', async (_name, write) => {
    for (const body of [
      'Bana 0532 123 45 67 numarasından ulaşın',
      'mail: ayse@example.com',
      'instagram hesabımız var',
      'www.ornek.com adresine bakın',
      '   a   ',
      'x'.repeat(2001),
    ]) {
      await expect(write(body)).rejects.toMatchObject({ statusCode: 422 })
    }
    expect(m.tx.productQuestionMessage.create).not.toHaveBeenCalled()
    expect(m.tx.notificationOutbox.upsert).not.toHaveBeenCalled()
  })

  it.each(writePaths)('%s stores the trimmed text', async (_name, write) => {
    await write('   Rengi nasıl?   ')
    expect(m.tx.productQuestionMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: 'Rengi nasıl?' }) }),
    )
  })
})

describe('opening a pre-sale question', () => {
  it.each([
    ['unpublished product', { status: 'unlisted' }, 409],
    ['seller on vacation', { seller: { status: 'active', vacationModeEnabled: true, userId: 'su1' } }, 409],
    ['suspended seller', { seller: { status: 'suspended', vacationModeEnabled: false, userId: 'su1' } }, 409],
    ['own product', { seller: { status: 'active', vacationModeEnabled: false, userId: 'c1' } }, 403],
  ])('rejects %s', async (_name, productPatch, statusCode) => {
    m.prisma.product.findUnique.mockResolvedValue({
      status: 'published',
      sellerId: 's1',
      seller: { status: 'active', vacationModeEnabled: false, userId: 'su1' },
      ...productPatch,
    })
    await expect(ask()).rejects.toMatchObject({ statusCode })
    expect(m.tx.productQuestionThread.create).not.toHaveBeenCalled()
  })

  it('rejects non-customer accounts', async () => {
    await expect(ask({ customerRole: 'seller' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('opens the thread, its first message and one seller notification in one transaction', async () => {
    const result = await ask()
    expect(result).toMatchObject({ threadId: 't1', created: true })
    expect(m.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(m.tx.productQuestionThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ threadKey: 'c1:p1:presale', sellerId: 's1', orderId: null }),
      }),
    )
    const outbox = m.tx.notificationOutbox.upsert.mock.calls[0]![0]
    expect(outbox.create).toMatchObject({
      eventKey: 'product-question:t1:seller:turn:1',
      userId: 'su1',
      type: 'seller_product_question',
    })
    const payload = outbox.create.payload
    expect(payload.emailTo).toBe('seller@example.test')
    expect(payload.data.customerName).toBe('Ayşe Y.')
    expect(JSON.stringify(payload)).not.toContain('ayse@example.test')
  })

  it('joins an existing conversation instead of opening a second one', async () => {
    m.prisma.productQuestionThread.findUnique.mockResolvedValue({ id: 't1' })
    const result = await ask()
    expect(result).toMatchObject({ threadId: 't1', created: false, notified: false })
    expect(m.tx.productQuestionThread.create).not.toHaveBeenCalled()
    expect(m.tx.notificationOutbox.upsert).not.toHaveBeenCalled()
  })

  it('falls back to the winning conversation on a unique-key race', async () => {
    m.prisma.productQuestionThread.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 't-winner' })
    m.prisma.$transaction
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' })
      })
    const result = await ask()
    expect(result).toMatchObject({ threadId: 't-winner', created: false, notified: false })
  })
})

describe('opening a question about an ordered product', () => {
  it('verifies customer, order, product and seller together and takes the seller from the line', async () => {
    await ask({ orderId: 'o1' })
    expect(m.prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1', customerId: 'c1' },
        select: expect.objectContaining({
          lines: expect.objectContaining({ where: { productId: 'p1' } }),
        }),
      }),
    )
    // The product's current sale state is not consulted for order questions.
    expect(m.prisma.product.findUnique).not.toHaveBeenCalled()
    expect(m.tx.productQuestionThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: 's-line', orderId: 'o1', threadKey: 'c1:p1:o1' }),
      }),
    )
  })

  it("rejects another customer's order as not found", async () => {
    m.prisma.order.findFirst.mockResolvedValue(null)
    await expect(ask({ orderId: 'o1' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects an order whose payment is not confirmed', async () => {
    m.prisma.order.findFirst.mockResolvedValue({
      paymentConfirmedAt: null,
      lines: [{ sellerId: 's1', seller: { status: 'active', userId: 'su1' } }],
    })
    await expect(ask({ orderId: 'o1' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects a product that is not in the order', async () => {
    m.prisma.order.findFirst.mockResolvedValue({ paymentConfirmedAt: new Date(), lines: [] })
    await expect(ask({ orderId: 'o1' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('accepts a suspended seller but not a rejected one', async () => {
    m.prisma.order.findFirst.mockResolvedValue({
      paymentConfirmedAt: new Date(),
      lines: [{ sellerId: 's1', seller: { status: 'suspended', userId: 'su1' } }],
    })
    await expect(ask({ orderId: 'o1' })).resolves.toMatchObject({ created: true })
    m.prisma.order.findFirst.mockResolvedValue({
      paymentConfirmedAt: new Date(),
      lines: [{ sellerId: 's1', seller: { status: 'rejected', userId: 'su1' } }],
    })
    await expect(ask({ orderId: 'o1' })).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('replies and the turn decision under the row lock', () => {
  it('takes the row lock first and stores the message under the locked sequence number', async () => {
    await svc().replyAsSeller({ threadId: 't1', sellerId: 's1', authorUserId: 'su1', body: 'Evet' })
    const [lock, finish] = m.tx.productQuestionThread.update.mock.calls.map((call) => call[0])
    expect(lock).toMatchObject({ where: { id: 't1' }, data: { messageSeq: { increment: 1 } } })
    expect(m.tx.productQuestionThread.update.mock.invocationCallOrder[0]).toBeLessThan(
      m.tx.productQuestionMessage.create.mock.invocationCallOrder[0]!,
    )
    expect(m.tx.productQuestionMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seq: 2, authorRole: 'seller' }) }),
    )
    expect(finish!.data).toMatchObject({ lastSellerMessageSeq: 2 })
  })

  it('notifies the customer only when the seller reply turns the conversation over', async () => {
    await svc().replyAsSeller({ threadId: 't1', sellerId: 's1', authorUserId: 'su1', body: 'Evet' })
    const finish = m.tx.productQuestionThread.update.mock.calls[1]![0]
    expect(finish.data).toMatchObject({
      status: 'waiting_for_customer',
      turnSeq: { increment: 1 },
    })
    expect(m.tx.notificationOutbox.upsert.mock.calls[0]![0].create).toMatchObject({
      eventKey: 'product-question:t1:customer:turn:2',
      userId: 'c1',
      type: 'customer_product_question_answered',
    })

    m.tx.notificationOutbox.upsert.mockClear()
    m.tx.productQuestionThread.update.mockClear()
    m.state.lockStatus = 'waiting_for_customer'
    await svc().replyAsSeller({ threadId: 't1', sellerId: 's1', authorUserId: 'su1', body: 'Ek bilgi' })
    expect(m.tx.notificationOutbox.upsert).not.toHaveBeenCalled()
    expect(m.tx.productQuestionThread.update.mock.calls[1]![0].data).not.toHaveProperty('status')
  })

  it('scopes a seller reply to the seller and a customer reply to the customer', async () => {
    m.prisma.productQuestionThread.findFirst.mockResolvedValue(null)
    await expect(
      svc().replyAsSeller({ threadId: 't1', sellerId: 'other', authorUserId: 'x', body: 'Merhaba' }),
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      svc().replyAsCustomer({ threadId: 't1', customerId: 'other', body: 'Merhaba' }),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(m.prisma.productQuestionThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1', sellerId: 'other' } }),
    )
    expect(m.prisma.productQuestionThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1', customerId: 'other' } }),
    )
  })

  it('keeps the conversation read-only for the customer once the seller is no longer operational', async () => {
    m.prisma.productQuestionThread.findFirst.mockResolvedValue({ id: 't1', seller: { status: 'rejected' } })
    await expect(
      svc().replyAsCustomer({ threadId: 't1', customerId: 'c1', body: 'Merhaba' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('does not move the read boundary when a message is sent', async () => {
    await svc().replyAsCustomer({ threadId: 't1', customerId: 'c1', body: 'Merhaba' })
    for (const [call] of m.tx.productQuestionThread.update.mock.calls) {
      expect(call.data).not.toHaveProperty('customerLastReadSeq')
      expect(call.data).not.toHaveProperty('sellerLastReadSeq')
    }
  })
})

describe('read receipts', () => {
  it('requires the message to belong to a thread owned by the viewer', async () => {
    m.prisma.productQuestionMessage.findFirst.mockResolvedValue(null)
    await expect(
      svc().markRead('t1', { role: 'seller', sellerId: 's1' }, 'm-foreign'),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(m.prisma.productQuestionMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-foreign', threadId: 't1', thread: { sellerId: 's1' } } }),
    )
    expect(m.prisma.productQuestionThread.updateMany).not.toHaveBeenCalled()
  })

  it('only moves the boundary forward, to the reported message sequence number', async () => {
    await svc().markRead('t1', { role: 'customer', customerId: 'c1' }, 'm1')
    expect(m.prisma.productQuestionThread.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', customerId: 'c1', customerLastReadSeq: { lt: 5 } },
      data: { customerLastReadSeq: 5 },
    })
  })
})

describe('list pagination', () => {
  it('pages a seller list with a stable order and clamps an out-of-range page', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const count = vi.fn().mockResolvedValue(101)
    Object.assign(m.prisma.productQuestionThread, { findMany, count })
    const result = await svc().listForSeller('s1', { status: 'waiting_for_seller', page: 9 })
    expect(result).toMatchObject({ total: 101, page: 4, totalPages: 4 })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: 's1', status: 'waiting_for_seller' },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: 90,
        take: 30,
      }),
    )
  })
})
