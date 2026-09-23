/**
 * Product question routes: guard order (CSRF → IP limit → session → user limit),
 * and ownership — a customer or seller can never read or write someone else's
 * conversation, sellers never receive the customer's e-mail, and every admin
 * read is audited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { generateCsrfToken } from '../../packages/security/src/csrf'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  getSession: vi.fn(),
  getOperationalSellerIdOrThrow: vi.fn(),
  checkRateLimit: vi.fn(),
  checkUserRateLimit: vi.fn(),
  prisma: {} as Record<string, unknown>,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: h.getSession } } }))
vi.mock('@/lib/route-seller', () => ({
  getOperationalSellerIdOrThrow: h.getOperationalSellerIdOrThrow,
}))
vi.mock('@hanuja/api/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  checkUserRateLimit: h.checkUserRateLimit,
}))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => h.prisma }))

import { POST as askPost } from '../../apps/web/src/app/api/product-questions/route'
import { POST as customerReplyPost } from '../../apps/web/src/app/api/product-questions/[id]/messages/route'
import { POST as customerReadPost } from '../../apps/web/src/app/api/product-questions/[id]/read/route'
import { POST as sellerReplyPost } from '../../apps/seller-panel/src/app/api/seller/product-questions/[id]/messages/route'
import { POST as sellerReadPost } from '../../apps/seller-panel/src/app/api/seller/product-questions/[id]/read/route'
import { createProductQuestionService } from '../../api/services/product-question.service'

function request(url: string, body: unknown, options: { csrf?: boolean } = {}) {
  const token = generateCsrfToken()
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.csrf === false ? {} : { cookie: `hanuja-csrf=${token}`, 'x-csrf-token': token }),
    },
    body: JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function fakePrisma() {
  const tx = {
    productQuestionThread: {
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
    },
    productQuestionMessage: { create: vi.fn() },
    notificationOutbox: { upsert: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  }
  return {
    tx,
    product: { findUnique: vi.fn() },
    order: { findFirst: vi.fn() },
    productQuestionThread: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
    },
    productQuestionMessage: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  }
}

describe('product question routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.calls.length = 0
    vi.stubEnv('CSRF_STRICT', 'true')
    h.prisma = fakePrisma()
    h.checkRateLimit.mockImplementation(async () => {
      h.calls.push('ip-limit')
      return { allowed: true, response: null }
    })
    h.getSession.mockImplementation(async () => {
      h.calls.push('session')
      return { user: { id: 'c1', role: 'customer' } }
    })
    h.checkUserRateLimit.mockImplementation(async (userId: string) => {
      h.calls.push(`user-limit:${userId}`)
      return { allowed: true, response: null }
    })
    h.getOperationalSellerIdOrThrow.mockResolvedValue('s1')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects a missing CSRF token before any limit or session work', async () => {
    const res = await askPost(
      request('http://localhost/api/product-questions', { productId: 'p1', body: 'Soru' }, { csrf: false }),
    )
    expect(res.status).toBe(403)
    expect(h.calls).toEqual([])
  })

  it('runs the per-user limit only after the session is verified', async () => {
    h.getSession.mockImplementation(async () => {
      h.calls.push('session')
      return null
    })
    const res = await askPost(request('http://localhost/api/product-questions', { productId: 'p1', body: 'Soru' }))
    expect(res.status).toBe(401)
    expect(h.calls).toEqual(['ip-limit', 'session'])
    expect(h.checkUserRateLimit).not.toHaveBeenCalled()
  })

  it('applies the guards in order for every write route', async () => {
    const routes: Array<() => Promise<Response>> = [
      () => askPost(request('http://localhost/api/product-questions', { productId: 'p1', body: 'Soru' })),
      () => customerReplyPost(request('http://localhost/api/product-questions/t1/messages', { body: 'Merhaba' }), params('t1')),
      () => customerReadPost(request('http://localhost/api/product-questions/t1/read', { lastSeenMessageId: 'm1' }), params('t1')),
    ]
    for (const call of routes) {
      h.calls.length = 0
      await call()
      expect(h.calls.slice(0, 3)).toEqual(['ip-limit', 'session', 'user-limit:c1'])
    }
  })

  it('returns the rate-limit response when the user limit is exceeded', async () => {
    h.checkUserRateLimit.mockResolvedValue({
      allowed: false,
      response: NextResponse.json({ error: 'Çok fazla istek' }, { status: 429 }),
    })
    const res = await askPost(request('http://localhost/api/product-questions', { productId: 'p1', body: 'Soru' }))
    expect(res.status).toBe(429)
  })

  it("does not let a customer write to or mark read another customer's conversation", async () => {
    const reply = await customerReplyPost(
      request('http://localhost/api/product-questions/t-other/messages', { body: 'Merhaba' }),
      params('t-other'),
    )
    expect(reply.status).toBe(404)
    const prisma = h.prisma as ReturnType<typeof fakePrisma>
    expect(prisma.productQuestionThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-other', customerId: 'c1' } }),
    )
    expect(prisma.tx.productQuestionMessage.create).not.toHaveBeenCalled()

    const read = await customerReadPost(
      request('http://localhost/api/product-questions/t-other/read', { lastSeenMessageId: 'm1' }),
      params('t-other'),
    )
    expect(read.status).toBe(404)
    expect(prisma.productQuestionThread.updateMany).not.toHaveBeenCalled()
  })

  it("does not let a seller write to or mark read another seller's conversation", async () => {
    h.getSession.mockImplementation(async () => {
      h.calls.push('session')
      return { user: { id: 'su1', role: 'seller' } }
    })
    const reply = await sellerReplyPost(
      request('http://localhost/api/seller/product-questions/t-other/messages', { body: 'Merhaba' }),
      params('t-other'),
    )
    expect(reply.status).toBe(404)
    const prisma = h.prisma as ReturnType<typeof fakePrisma>
    expect(prisma.productQuestionThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-other', sellerId: 's1' } }),
    )
    const read = await sellerReadPost(
      request('http://localhost/api/seller/product-questions/t-other/read', { lastSeenMessageId: 'm1' }),
      params('t-other'),
    )
    expect(read.status).toBe(404)
    expect(prisma.productQuestionMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1', threadId: 't-other', thread: { sellerId: 's1' } } }),
    )
  })

  it('rejects the seller route when the seller account is not operational', async () => {
    const { ForbiddenError } = await import('../../api/lib/errors')
    h.getOperationalSellerIdOrThrow.mockRejectedValue(new ForbiddenError('Satıcı hesabı kapalı'))
    const res = await sellerReplyPost(
      request('http://localhost/api/seller/product-questions/t1/messages', { body: 'Merhaba' }),
      params('t1'),
    )
    expect(res.status).toBe(403)
  })
})

describe('product question request bodies', () => {
  function rawRequest(url: string, body: string) {
    const token = generateCsrfToken()
    return new NextRequest(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `hanuja-csrf=${token}`,
        'x-csrf-token': token,
      },
      body,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CSRF_STRICT', 'true')
    h.prisma = fakePrisma()
    h.checkRateLimit.mockResolvedValue({ allowed: true, response: null })
    h.checkUserRateLimit.mockResolvedValue({ allowed: true, response: null })
    h.getSession.mockResolvedValue({ user: { id: 'c1', role: 'customer' } })
    h.getOperationalSellerIdOrThrow.mockResolvedValue('s1')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ['empty', ''],
    ['truncated', '{"lastSeenMessageId":'],
    ['not json', 'okundu'],
  ])('answers a %s body with 400 INVALID_JSON on every route, not 500', async (_name, body) => {
    const responses = await Promise.all([
      askPost(rawRequest('http://localhost/api/product-questions', body)),
      customerReplyPost(rawRequest('http://localhost/api/product-questions/t1/messages', body), params('t1')),
      customerReadPost(rawRequest('http://localhost/api/product-questions/t1/read', body), params('t1')),
      sellerReplyPost(rawRequest('http://localhost/api/seller/product-questions/t1/messages', body), params('t1')),
      sellerReadPost(rawRequest('http://localhost/api/seller/product-questions/t1/read', body), params('t1')),
    ])
    for (const response of responses) {
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_JSON' })
    }
  })

  it('keeps a real database failure a 500', async () => {
    const prisma = h.prisma as ReturnType<typeof fakePrisma>
    prisma.productQuestionMessage.findFirst.mockRejectedValue(new Error('connection terminated'))
    const response = await customerReadPost(
      rawRequest('http://localhost/api/product-questions/t1/read', '{"lastSeenMessageId":"m1"}'),
      params('t1'),
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
  })
})

describe('product question data exposure', () => {
  it('never selects the customer e-mail for the seller view', async () => {
    const prisma = fakePrisma()
    prisma.productQuestionThread.findFirst.mockResolvedValue({
      id: 't1',
      status: 'waiting_for_seller',
      customer: { name: 'Ayşe Yılmaz' },
      product: { id: 'p1', name: 'Gea', slug: 'gea', status: 'published', images: [] },
      seller: { id: 's1', displayName: 'Atelier', slug: 'atelier', status: 'active' },
      order: null,
      messages: [],
    })
    const dto = await createProductQuestionService({ prisma: prisma as never }).getForSeller('t1', 's1')
    const query = prisma.productQuestionThread.findFirst.mock.calls[0]![0]
    expect(query.where).toEqual({ id: 't1', sellerId: 's1' })
    expect(query.include.customer).toEqual({ select: { name: true } })
    expect(dto?.customerName).toBe('Ayşe Y.')
    expect(JSON.stringify(dto)).not.toMatch(/@/)
  })

  it('writes an audit entry in the same transaction as every admin read', async () => {
    const prisma = fakePrisma()
    prisma.tx.productQuestionThread.findUnique.mockResolvedValue({
      id: 't1',
      sellerId: 's1',
      customerId: 'c1',
      status: 'waiting_for_seller',
      customer: { id: 'c1', name: 'Ayşe', email: 'ayse@example.test' },
      product: { id: 'p1', name: 'Gea', slug: 'gea', status: 'published', images: [] },
      seller: { id: 's1', displayName: 'Atelier', slug: 'atelier', status: 'active' },
      order: null,
      messages: [],
    })
    const view = await createProductQuestionService({ prisma: prisma as never }).getForAdminWithAudit(
      't1',
      'admin-1',
      '10.0.0.1',
    )
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-1',
        actionType: 'product_question_viewed',
        targetType: 'product_question_thread',
        targetId: 't1',
        ipAddress: '10.0.0.1',
      }),
    })
    expect(view?.customer.email).toBe('ay***@example.test')
    expect(view?.canReply).toBe(false)
  })

  it('carries no message content in the admin list', async () => {
    const prisma = fakePrisma() as ReturnType<typeof fakePrisma> & {
      productQuestionThread: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> }
    }
    prisma.productQuestionThread.findMany = vi.fn().mockResolvedValue([
      {
        id: 't1',
        status: 'waiting_for_seller',
        lastMessageAt: new Date(),
        lastCustomerMessageSeq: 1,
        lastSellerMessageSeq: 0,
        customerLastReadSeq: 0,
        sellerLastReadSeq: 0,
        product: { name: 'Gea', slug: 'gea', images: [] },
        seller: { displayName: 'Atelier' },
        customer: { name: 'Ayşe' },
        order: null,
        messages: [{ body: 'gizli içerik', authorRole: 'customer' }],
      },
    ])
    prisma.productQuestionThread.count = vi.fn().mockResolvedValue(1)
    const list = await createProductQuestionService({ prisma: prisma as never }).listForAdmin()
    expect(JSON.stringify(list)).not.toContain('gizli içerik')
  })
})
