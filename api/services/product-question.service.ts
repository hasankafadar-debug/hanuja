/**
 * Product questions — private customer ↔ seller conversations (e-mail plan phase 4).
 *
 * Concurrency rules (see docs/07-operations/email-phase-4-report.md):
 *   - one thread per `threadKey` (unique index); a racing second opener falls
 *     back to appending to the winner's thread;
 *   - every message first increments the thread's message counter, taking the
 *     row lock; its sequence number, the status read that decides the
 *     "other side" e-mail and the "last message" fields are all written under
 *     that lock, so parallel messages in one turn produce one e-mail and
 *     sequence numbers follow commit order;
 *   - unread and read boundaries are message sequence numbers (not clocks);
 *     a boundary only moves forward and only to a message the viewer's screen
 *     reported as shown.
 */
import type { Prisma, PrismaClient, ProductQuestionStatus, UserRole } from '@prisma/client'
import { maskCustomerName, maskEmail } from '@hanuja/security'
import {
  buildThreadKey,
  checkOrderAskable,
  checkPresaleAskable,
  checkQuestionBodyLength,
  isSellerOperational,
  isThreadUnread,
  PRODUCT_QUESTION_MESSAGE_MAX,
  PRODUCT_QUESTION_MESSAGE_MIN,
  statusAfterMessage,
  statusTurnedOverBy,
  type ProductQuestionAuthor,
} from '../domain/product-question'
import { resolveEmailImageUrl, EMAIL_LINE_IMAGE_SELECT } from '../lib/email-line-items'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { assertNoContactSharing } from './contact-sharing-guard.service'
import { recordNotification } from './notification-outbox.service'

type Tx = Prisma.TransactionClient

const EXCERPT_LENGTH = 400

const PRESALE_REJECTION: Record<string, string> = {
  own_product: 'Kendi ürününüze soru soramazsınız.',
  product_not_published: 'Bu ürün şu anda satışta değil.',
  seller_not_active: 'Bu mağaza şu anda soru kabul etmiyor.',
  seller_on_vacation: 'Mağaza tatilde; şu anda soru kabul etmiyor.',
}

const ORDER_REJECTION: Record<string, string> = {
  payment_not_confirmed: 'Ödemesi onaylanmamış sipariş için satıcıya soru sorulamaz.',
  product_not_in_order: 'Bu ürün seçilen siparişte bulunmuyor.',
  seller_not_operational: 'Bu mağaza şu anda soru kabul etmiyor.',
}

/**
 * The single body gate for all three write paths (question, customer reply,
 * seller reply): trim, length bounds, then the contact-sharing guard on the
 * exact text that will be stored.
 */
export function prepareQuestionMessageBody(raw: string): string {
  const check = checkQuestionBodyLength(raw)
  if (!check.ok) {
    throw new ValidationError(
      check.reason === 'too_short'
        ? `Mesaj en az ${PRODUCT_QUESTION_MESSAGE_MIN} karakter olmalıdır.`
        : `Mesaj en fazla ${PRODUCT_QUESTION_MESSAGE_MAX} karakter olabilir.`,
    )
  }
  assertNoContactSharing(check.body)
  return check.body
}

function excerpt(body: string): string {
  return body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH - 1)}…` : body
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2002'
}

export function customerThreadUrl(threadId: string) {
  return `${getWebBaseUrl()}/hesabim/sorularim/${threadId}`
}

export function sellerThreadUrl(threadId: string) {
  return `${getSellerPanelUrl()}/musteri-sorulari/${threadId}`
}

const NOTIFY_SELECT = {
  id: true,
  turnSeq: true,
  customerId: true,
  customer: { select: { id: true, name: true, email: true } },
  seller: {
    select: { id: true, displayName: true, userId: true, user: { select: { email: true } } },
  },
  product: { select: { name: true, ...EMAIL_LINE_IMAGE_SELECT } },
  order: { select: { id: true, publicNumber: true } },
} as const

type NotifyThread = Prisma.ProductQuestionThreadGetPayload<{ select: typeof NOTIFY_SELECT }>

async function recordTurnNotification(
  tx: Tx,
  thread: NotifyThread,
  author: ProductQuestionAuthor,
  body: string,
) {
  const orderNumber = thread.order
    ? formatOrderNumber(thread.order.publicNumber, thread.order.id)
    : undefined
  if (author === 'customer') {
    await recordNotification(tx, {
      eventKey: `product-question:${thread.id}:seller:turn:${thread.turnSeq}`,
      userId: thread.seller.userId,
      emailTo: thread.seller.user.email,
      type: 'seller_product_question',
      title: 'Müşteri Sorusu',
      body: `${thread.product.name} ürünü için yeni bir müşteri sorusu var.`,
      data: {
        threadId: thread.id,
        sellerId: thread.seller.id,
        sellerName: thread.seller.displayName,
        productName: thread.product.name,
        productImageUrl: resolveEmailImageUrl(thread.product.images),
        customerName: maskCustomerName(thread.customer.name),
        ...(orderNumber ? { orderNumber } : {}),
        messageExcerpt: excerpt(body),
        panelUrl: sellerThreadUrl(thread.id),
      },
    })
    return
  }
  await recordNotification(tx, {
    eventKey: `product-question:${thread.id}:customer:turn:${thread.turnSeq}`,
    userId: thread.customerId,
    emailTo: thread.customer.email,
    type: 'customer_product_question_answered',
    title: 'Sorunuz yanıtlandı',
    body: `${thread.seller.displayName}, ${thread.product.name} hakkındaki sorunuzu yanıtladı.`,
    data: {
      threadId: thread.id,
      customerName: thread.customer.name ?? '',
      sellerName: thread.seller.displayName,
      productName: thread.product.name,
      productImageUrl: resolveEmailImageUrl(thread.product.images),
      ...(orderNumber ? { orderNumber } : {}),
      messageExcerpt: excerpt(body),
      threadUrl: customerThreadUrl(thread.id),
    },
  })
}

/**
 * Appends a message. The first statement increments the thread's message
 * counter, which takes the row lock; everything after it — the message's
 * sequence number, its timestamp, the status read that decides the e-mail and
 * the "last message" fields — happens under that lock. Parallel writers are
 * therefore serialised in lock order: sequence numbers follow commit order, a
 * later writer always sees the earlier writer's status (one e-mail per turn),
 * and nothing written later can move a boundary backwards.
 */
export async function appendProductQuestionMessage(
  tx: Tx,
  params: { threadId: string; author: ProductQuestionAuthor; authorId: string; body: string },
) {
  const locked = await tx.productQuestionThread.update({
    where: { id: params.threadId },
    data: { messageSeq: { increment: 1 } },
    select: { messageSeq: true, status: true, lastMessageAt: true },
  })
  const seq = locked.messageSeq
  const clock = new Date()
  // Display timestamp only; never earlier than what is already stored (clock skew between instances).
  const now = clock > locked.lastMessageAt ? clock : locked.lastMessageAt
  const turned = locked.status === statusTurnedOverBy(params.author)

  const message = await tx.productQuestionMessage.create({
    data: {
      threadId: params.threadId,
      seq,
      authorId: params.authorId,
      authorRole: params.author,
      body: params.body,
      createdAt: now,
    },
    select: { id: true },
  })
  const thread = await tx.productQuestionThread.update({
    where: { id: params.threadId },
    data: {
      lastMessageAt: now,
      ...(params.author === 'customer'
        ? { lastCustomerMessageSeq: seq }
        : { lastSellerMessageSeq: seq }),
      ...(turned
        ? { status: statusAfterMessage(params.author), turnSeq: { increment: 1 } }
        : {}),
    },
    select: NOTIFY_SELECT,
  })
  if (turned) {
    await recordTurnNotification(tx, thread, params.author, params.body)
  }
  return { messageId: message.id, seq, notified: turned }
}

export type ProductQuestionViewer =
  | { role: 'customer'; customerId: string }
  | { role: 'seller'; sellerId: string }

function ownershipWhere(viewer: ProductQuestionViewer): Prisma.ProductQuestionThreadWhereInput {
  return viewer.role === 'customer'
    ? { customerId: viewer.customerId }
    : { sellerId: viewer.sellerId }
}

const THREAD_DETAIL_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      images: {
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        take: 1,
        select: { url: true },
      },
    },
  },
  seller: { select: { id: true, displayName: true, slug: true, status: true } },
  order: { select: { id: true, publicNumber: true } },
  messages: {
    orderBy: { seq: 'asc' },
    select: { id: true, authorRole: true, body: true, createdAt: true },
  },
} satisfies Prisma.ProductQuestionThreadInclude

type ThreadDetail = Prisma.ProductQuestionThreadGetPayload<{ include: typeof THREAD_DETAIL_INCLUDE }>

export interface ProductQuestionMessageDto {
  id: string
  authorRole: UserRole
  body: string
  createdAt: string
}

export interface ProductQuestionThreadDto {
  id: string
  status: ProductQuestionStatus
  product: { id: string; name: string; slug: string; published: boolean; imageUrl: string | null }
  seller: { displayName: string; slug: string }
  order: { id: string; number: string } | null
  messages: ProductQuestionMessageDto[]
  canReply: boolean
}

function toThreadDto(thread: ThreadDetail, canReply: boolean): ProductQuestionThreadDto {
  return {
    id: thread.id,
    status: thread.status,
    product: {
      id: thread.product.id,
      name: thread.product.name,
      slug: thread.product.slug,
      published: thread.product.status === 'published',
      imageUrl: thread.product.images[0]?.url ?? null,
    },
    seller: { displayName: thread.seller.displayName, slug: thread.seller.slug },
    order: thread.order
      ? { id: thread.order.id, number: formatOrderNumber(thread.order.publicNumber, thread.order.id) }
      : null,
    messages: thread.messages.map((m) => ({
      id: m.id,
      authorRole: m.authorRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
    canReply,
  }
}

const THREAD_LIST_SELECT = {
  id: true,
  status: true,
  lastMessageAt: true,
  lastCustomerMessageSeq: true,
  lastSellerMessageSeq: true,
  customerLastReadSeq: true,
  sellerLastReadSeq: true,
  product: {
    select: {
      name: true,
      slug: true,
      images: {
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        take: 1,
        select: { url: true },
      },
    },
  },
  seller: { select: { displayName: true } },
  customer: { select: { name: true } },
  order: { select: { id: true, publicNumber: true } },
  messages: {
    orderBy: { seq: 'desc' },
    take: 1,
    select: { body: true, authorRole: true },
  },
} satisfies Prisma.ProductQuestionThreadSelect

type ThreadListRow = Prisma.ProductQuestionThreadGetPayload<{ select: typeof THREAD_LIST_SELECT }>

export interface ProductQuestionListItemDto {
  id: string
  status: ProductQuestionStatus
  productName: string
  productSlug: string
  productImageUrl: string | null
  counterpartName: string
  orderNumber: string | null
  lastMessagePreview: string
  lastMessageAt: string
  unread: boolean
}

function toListItem(row: ThreadListRow, viewer: 'customer' | 'seller' | 'admin'): ProductQuestionListItemDto {
  const lastBody = row.messages[0]?.body ?? ''
  return {
    id: row.id,
    status: row.status,
    productName: row.product.name,
    productSlug: row.product.slug,
    productImageUrl: row.product.images[0]?.url ?? null,
    counterpartName:
      viewer === 'customer' ? row.seller.displayName : maskCustomerName(row.customer.name),
    orderNumber: row.order ? formatOrderNumber(row.order.publicNumber, row.order.id) : null,
    // Admin lists carry no message content; content is shown only in the audited detail view.
    lastMessagePreview:
      viewer === 'admin' ? '' : lastBody.length > 140 ? `${lastBody.slice(0, 139)}…` : lastBody,
    lastMessageAt: row.lastMessageAt.toISOString(),
    unread:
      viewer === 'customer'
        ? isThreadUnread(row.lastSellerMessageSeq, row.customerLastReadSeq)
        : viewer === 'seller'
          ? isThreadUnread(row.lastCustomerMessageSeq, row.sellerLastReadSeq)
          : false,
  }
}

export const PRODUCT_QUESTION_PAGE_SIZE = 30

export interface ProductQuestionListPage {
  items: ProductQuestionListItemDto[]
  total: number
  page: number
  totalPages: number
}

export function createProductQuestionService({ prisma }: { prisma: PrismaClient }) {
  async function resolveTarget(params: {
    customerId: string
    productId: string
    orderId: string | null
  }): Promise<{ sellerId: string }> {
    if (params.orderId === null) {
      const product = await prisma.product.findUnique({
        where: { id: params.productId },
        select: {
          status: true,
          sellerId: true,
          seller: { select: { status: true, vacationModeEnabled: true, userId: true } },
        },
      })
      if (!product) throw new NotFoundError('Ürün')
      const verdict = checkPresaleAskable({
        productStatus: product.status,
        sellerStatus: product.seller.status,
        vacationModeEnabled: product.seller.vacationModeEnabled,
        sellerUserId: product.seller.userId,
        customerId: params.customerId,
      })
      if (!verdict.ok) {
        if (verdict.reason === 'own_product') throw new ForbiddenError(PRESALE_REJECTION.own_product)
        throw new ConflictError(PRESALE_REJECTION[verdict.reason] ?? 'Bu ürüne şu anda soru sorulamaz.')
      }
      return { sellerId: product.sellerId }
    }

    // Customer, order, product and seller are verified together: the seller
    // comes from the ordered line, never from the product's current owner.
    const order = await prisma.order.findFirst({
      where: { id: params.orderId, customerId: params.customerId },
      select: {
        paymentConfirmedAt: true,
        lines: {
          where: { productId: params.productId },
          take: 1,
          select: { sellerId: true, seller: { select: { status: true, userId: true } } },
        },
      },
    })
    const line = order?.lines[0]
    const verdict = checkOrderAskable({
      orderFound: Boolean(order),
      paymentConfirmed: Boolean(order?.paymentConfirmedAt),
      lineFound: Boolean(line),
      sellerStatus: line?.seller.status ?? null,
    })
    if (!verdict.ok) {
      if (verdict.reason === 'order_not_found') throw new NotFoundError('Sipariş')
      throw new ConflictError(ORDER_REJECTION[verdict.reason] ?? 'Bu sipariş için soru sorulamaz.')
    }
    if (line!.seller.userId === params.customerId) {
      throw new ForbiddenError(PRESALE_REJECTION.own_product)
    }
    return { sellerId: line!.sellerId }
  }

  /**
   * One page of a customer's or seller's conversations, newest first with a
   * stable tie-break. An out-of-range page is clamped to the last page.
   */
  async function listPage(
    where: Prisma.ProductQuestionThreadWhereInput,
    viewer: 'customer' | 'seller',
    requestedPage = 1,
  ): Promise<ProductQuestionListPage> {
    const total = await prisma.productQuestionThread.count({ where })
    const totalPages = Math.max(1, Math.ceil(total / PRODUCT_QUESTION_PAGE_SIZE))
    const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages)
    const rows = await prisma.productQuestionThread.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PRODUCT_QUESTION_PAGE_SIZE,
      take: PRODUCT_QUESTION_PAGE_SIZE,
      select: THREAD_LIST_SELECT,
    })
    return { items: rows.map((row) => toListItem(row, viewer)), total, page, totalPages }
  }

  async function replyAsCustomerInternal(threadId: string, customerId: string, body: string) {
    const thread = await prisma.productQuestionThread.findFirst({
      where: { id: threadId, customerId },
      select: { id: true, seller: { select: { status: true } } },
    })
    if (!thread) throw new NotFoundError('Soru')
    if (!isSellerOperational(thread.seller.status)) {
      throw new ConflictError('Bu mağaza artık yanıt veremiyor; konuşma salt okunur.')
    }
    return prisma.$transaction((tx) =>
      appendProductQuestionMessage(tx, { threadId, author: 'customer', authorId: customerId, body }),
    )
  }

  return {
    async askQuestion(params: {
      customerId: string
      customerRole: UserRole
      productId: string
      orderId?: string | null
      body: string
    }) {
      const body = prepareQuestionMessageBody(params.body)
      if (params.customerRole !== 'customer') {
        throw new ForbiddenError('Yalnız müşteri hesapları satıcıya soru sorabilir.')
      }
      const orderId = params.orderId ?? null
      const { sellerId } = await resolveTarget({
        customerId: params.customerId,
        productId: params.productId,
        orderId,
      })
      const threadKey = buildThreadKey(params.customerId, params.productId, orderId)

      const existing = await prisma.productQuestionThread.findUnique({
        where: { threadKey },
        select: { id: true },
      })
      if (existing) {
        const result = await replyAsCustomerInternal(existing.id, params.customerId, body)
        return { threadId: existing.id, created: false, ...result }
      }

      try {
        return await prisma.$transaction(async (tx) => {
          const now = new Date()
          const thread = await tx.productQuestionThread.create({
            data: {
              threadKey,
              customerId: params.customerId,
              sellerId,
              productId: params.productId,
              orderId,
              status: 'waiting_for_seller',
              turnSeq: 1,
              messageSeq: 1,
              lastCustomerMessageSeq: 1,
              lastMessageAt: now,
            },
            select: { id: true },
          })
          const message = await tx.productQuestionMessage.create({
            data: {
              threadId: thread.id,
              seq: 1,
              authorId: params.customerId,
              authorRole: 'customer',
              body,
              createdAt: now,
            },
            select: { id: true },
          })
          const notifyThread = await tx.productQuestionThread.findUniqueOrThrow({
            where: { id: thread.id },
            select: NOTIFY_SELECT,
          })
          await recordTurnNotification(tx, notifyThread, 'customer', body)
          return { threadId: thread.id, created: true, messageId: message.id, notified: true }
        })
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        // A parallel request opened the same conversation first; this message
        // joins it under the normal turn rule (no second "new question" e-mail).
        const winner = await prisma.productQuestionThread.findUnique({
          where: { threadKey },
          select: { id: true },
        })
        if (!winner) throw error
        const result = await replyAsCustomerInternal(winner.id, params.customerId, body)
        return { threadId: winner.id, created: false, ...result }
      }
    },

    async replyAsCustomer(params: { threadId: string; customerId: string; body: string }) {
      const body = prepareQuestionMessageBody(params.body)
      return replyAsCustomerInternal(params.threadId, params.customerId, body)
    },

    /** Callers pass an operational seller (active or suspended); suspended sellers keep answering. */
    async replyAsSeller(params: {
      threadId: string
      sellerId: string
      authorUserId: string
      body: string
    }) {
      const body = prepareQuestionMessageBody(params.body)
      const thread = await prisma.productQuestionThread.findFirst({
        where: { id: params.threadId, sellerId: params.sellerId },
        select: { id: true },
      })
      if (!thread) throw new NotFoundError('Soru')
      return prisma.$transaction((tx) =>
        appendProductQuestionMessage(tx, {
          threadId: params.threadId,
          author: 'seller',
          authorId: params.authorUserId,
          body,
        }),
      )
    },

    /**
     * Moves the viewer's read boundary to a message their screen reported as
     * shown. The message must belong to this thread and the thread to the
     * viewer; the boundary never moves backwards.
     */
    async markRead(threadId: string, viewer: ProductQuestionViewer, lastSeenMessageId: string) {
      const message = await prisma.productQuestionMessage.findFirst({
        where: { id: lastSeenMessageId, threadId, thread: ownershipWhere(viewer) },
        select: { seq: true },
      })
      if (!message) throw new NotFoundError('Mesaj')
      const seenSeq = message.seq
      const result =
        viewer.role === 'customer'
          ? await prisma.productQuestionThread.updateMany({
              where: {
                id: threadId,
                customerId: viewer.customerId,
                customerLastReadSeq: { lt: seenSeq },
              },
              data: { customerLastReadSeq: seenSeq },
            })
          : await prisma.productQuestionThread.updateMany({
              where: {
                id: threadId,
                sellerId: viewer.sellerId,
                sellerLastReadSeq: { lt: seenSeq },
              },
              data: { sellerLastReadSeq: seenSeq },
            })
      return { advanced: result.count === 1 }
    },

    async listForCustomer(customerId: string, options: { page?: number } = {}) {
      const where: Prisma.ProductQuestionThreadWhereInput = { customerId }
      return listPage(where, 'customer', options.page)
    },

    async getForCustomer(threadId: string, customerId: string) {
      const thread = await prisma.productQuestionThread.findFirst({
        where: { id: threadId, customerId },
        include: THREAD_DETAIL_INCLUDE,
      })
      if (!thread) return null
      return toThreadDto(thread, isSellerOperational(thread.seller.status))
    },

    async listForSeller(
      sellerId: string,
      options: { status?: ProductQuestionStatus; page?: number } = {},
    ) {
      const where: Prisma.ProductQuestionThreadWhereInput = {
        sellerId,
        ...(options.status ? { status: options.status } : {}),
      }
      return listPage(where, 'seller', options.page)
    },

    /** Seller DTO: masked customer name only; the customer e-mail is never selected. */
    async getForSeller(threadId: string, sellerId: string) {
      const thread = await prisma.productQuestionThread.findFirst({
        where: { id: threadId, sellerId },
        include: { ...THREAD_DETAIL_INCLUDE, customer: { select: { name: true } } },
      })
      if (!thread) return null
      return {
        ...toThreadDto(thread, true),
        customerName: maskCustomerName(thread.customer.name),
      }
    },

    async countUnreadForSeller(sellerId: string) {
      return prisma.productQuestionThread.count({
        where: {
          sellerId,
          lastCustomerMessageSeq: { gt: prisma.productQuestionThread.fields.sellerLastReadSeq },
        },
      })
    },

    async listForAdmin(params: {
      sellerId?: string
      status?: ProductQuestionStatus
      skip?: number
      take?: number
    } = {}) {
      const where: Prisma.ProductQuestionThreadWhereInput = {
        ...(params.sellerId ? { sellerId: params.sellerId } : {}),
        ...(params.status ? { status: params.status } : {}),
      }
      const [rows, total] = await Promise.all([
        prisma.productQuestionThread.findMany({
          where,
          orderBy: { lastMessageAt: 'desc' },
          skip: params.skip ?? 0,
          take: params.take ?? 50,
          select: THREAD_LIST_SELECT,
        }),
        prisma.productQuestionThread.count({ where }),
      ])
      return {
        total,
        items: rows.map((row) => ({
          ...toListItem(row, 'admin'),
          sellerName: row.seller.displayName,
          customerName: row.customer.name ?? '-',
        })),
      }
    },

    /** Read-only admin view; every read writes an audit entry in the same transaction. */
    async getForAdminWithAudit(threadId: string, adminId: string, ipAddress?: string) {
      return prisma.$transaction(async (tx) => {
        const thread = await tx.productQuestionThread.findUnique({
          where: { id: threadId },
          include: {
            ...THREAD_DETAIL_INCLUDE,
            customer: { select: { id: true, name: true, email: true } },
          },
        })
        if (!thread) return null
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: adminId,
          actionType: 'product_question_viewed',
          targetType: 'product_question_thread',
          targetId: thread.id,
          newData: { sellerId: thread.sellerId, customerId: thread.customerId },
          ...(ipAddress ? { ipAddress } : {}),
        })
        return {
          ...toThreadDto(thread, false),
          customer: {
            id: thread.customer.id,
            name: thread.customer.name ?? '-',
            email: maskEmail(thread.customer.email),
          },
          sellerId: thread.sellerId,
        }
      })
    },
  }
}

export type ProductQuestionService = ReturnType<typeof createProductQuestionService>
