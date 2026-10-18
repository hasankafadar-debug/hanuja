import { assertNoContactSharing } from './contact-sharing-guard.service'
/**
 * Product questions. Hanuja is the customer-facing seller (see
 * docs/07-operations/hanuja-seller-model.md, "İletişim"): a customer and a designer
 * (seller) never write to each other. Every message is stored on one channel
 * (`audience`): a customer or designer message on its author's channel, a Hanuja
 * reply on the channel it is addressed to. The designer also reads the customer's
 * own messages, without the customer's identity (`isProductQuestionMessageVisibleTo`);
 * the customer never sees the designer's replies.
 *
 * Concurrency rules (see docs/07-operations/email-phase-4-report.md):
 *   - one thread per `threadKey` (unique index); a racing second opener falls
 *     back to appending to the winner's thread;
 *   - every message first increments the thread's message counter, taking the
 *     row lock; its sequence number, its turn number and the "last message"
 *     fields are all written under that lock, so sequence numbers follow commit
 *     order;
 *   - every customer or designer message opens a new turn and writes one in-app
 *     copy per admin user; a customer message also notifies the designer (one
 *     e-mail and in-app notification per message); a Hanuja reply sends at most
 *     one e-mail, to the party it is addressed to;
 *   - unread and read boundaries are message sequence numbers (not clocks);
 *     a boundary only moves forward and only to a message the viewer's screen
 *     reported as shown.
 */
import type { Prisma, PrismaClient, ProductQuestionStatus, UserRole } from '@prisma/client'
import { maskEmail } from '@hanuja/security'
import {
  buildThreadKey,
  canCompleteProductQuestionReview,
  checkOrderAskable,
  checkPresaleAskable,
  checkQuestionBodyLength,
  isSellerOperational,
  isProductQuestionMessageVisibleTo,
  isThreadUnread,
  PRODUCT_QUESTION_MESSAGE_MAX,
  PRODUCT_QUESTION_MESSAGE_MIN,
  type ProductQuestionAuthor,
} from '../domain/product-question'
import { resolveEmailImageUrl, EMAIL_LINE_IMAGE_SELECT } from '../lib/email-line-items'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { recordNotification } from './notification-outbox.service'

type Tx = Prisma.TransactionClient

const EXCERPT_LENGTH = 400

const PRESALE_REJECTION: Record<string, string> = {
  own_product: 'Kendi ürününüze soru soramazsınız.',
  product_not_published: 'Bu ürün şu anda satışta değil.',
  seller_not_active: 'Bu tasarımcı şu anda soru kabul etmiyor.',
  seller_on_vacation: 'Tasarımcı tatilde; şu anda soru kabul etmiyor.',
}

const ORDER_REJECTION: Record<string, string> = {
  payment_not_confirmed: 'Ödemesi onaylanmamış sipariş için tasarımcıya soru sorulamaz.',
  product_not_in_order: 'Bu ürün seçilen siparişte bulunmuyor.',
  seller_not_operational: 'Bu tasarımcı şu anda soru kabul etmiyor.',
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
  messageId: string,
) {
  const orderNumber = thread.order
    ? formatOrderNumber(thread.order.publicNumber, thread.order.id)
    : undefined
  const admins = await tx.user.findMany({ where: { role: 'admin' }, select: { id: true } })
  for (const admin of admins) {
    await recordNotification(tx, {
      eventKey: 'product-question:' + thread.id + ':admin:' + admin.id + ':turn:' + thread.turnSeq + ':' + author,
      userId: admin.id,
      type: 'admin_support_new_ticket',
      title: author === 'customer' ? 'Hanuja ürün sorusu' : 'Tasarımcı iç yanıtı',
      body: thread.product.name + ': ' + excerpt(body),
      data: { threadId: thread.id, orderNumber, adminUrl: '/musteri-sorulari/' + thread.id },
    })
  }
  if (author !== 'customer') return
  // The designer sees the customer's question (without the customer's identity)
  // and is told about every customer message: e-mail, in-app and the unread badge.
  await recordNotification(tx, {
    eventKey: 'product-question:' + thread.id + ':customer-message:' + messageId,
    userId: thread.seller.userId,
    emailTo: thread.seller.user.email,
    type: 'seller_product_question',
    title: 'Yeni ürün sorusu',
    body: thread.product.name + ' hakkında yeni bir müşteri sorusu var.',
    data: {
      threadId: thread.id,
      sellerId: thread.seller.id,
      sellerName: thread.seller.displayName,
      productName: thread.product.name,
      ...(resolveEmailImageUrl(thread.product.images) ? { productImageUrl: resolveEmailImageUrl(thread.product.images) } : {}),
      messageExcerpt: excerpt(body),
      panelUrl: sellerThreadUrl(thread.id),
      ...(orderNumber ? { orderNumber } : {}),
    },
  })
}

/**
 * Appends a customer or designer message. The first statement increments the
 * thread's message counter, which takes the row lock; everything after it —
 * the message's sequence number, its timestamp, the turn counter and the
 * "last message" fields — happens under that lock. Parallel writers are
 * therefore serialised in lock order: sequence numbers follow commit order and
 * nothing written later can move a boundary backwards.
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
  const turned = true

  const message = await tx.productQuestionMessage.create({
    data: {
      threadId: params.threadId,
      seq,
      authorId: params.authorId,
      authorRole: params.author,
      audience: params.author,
      body: params.body,
      createdAt: now,
    },
    select: { id: true },
  })
  const thread = await tx.productQuestionThread.update({
    where: { id: params.threadId },
    data: {
      lastMessageAt: now,
      // The designer's unread boundary also covers the customer's messages.
      ...(params.author === 'customer' ? { lastCustomerMessageSeq: seq } : {}),
      ...(turned
        ? { status: 'waiting_for_seller', turnSeq: { increment: 1 } }
        : {}),
    },
    select: NOTIFY_SELECT,
  })
  if (turned) {
    await recordTurnNotification(tx, thread, params.author, params.body, message.id)
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

/** Database form of `isProductQuestionMessageVisibleTo`; keep the two in step. */
function visibleMessageWhere(viewer: 'customer' | 'seller'): Prisma.ProductQuestionMessageWhereInput {
  return viewer === 'customer'
    ? { audience: 'customer', authorRole: { in: ['customer', 'admin'] } }
    : { OR: [{ authorRole: 'customer' }, { audience: 'seller', authorRole: { in: ['seller', 'admin'] } }] }
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
    select: { id: true, seq: true, authorRole: true, audience: true, body: true, createdAt: true },
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

function toThreadDto(thread: ThreadDetail, canReply: boolean, viewer?: 'customer' | 'seller'): ProductQuestionThreadDto {
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
    messages: thread.messages.filter((message) => !viewer || isProductQuestionMessageVisibleTo(viewer, message)).map((m) => ({
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
      'Hanuja',
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
      select: { ...THREAD_LIST_SELECT, messages: { ...THREAD_LIST_SELECT.messages, where: visibleMessageWhere(viewer) } },
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
      throw new ConflictError('Bu tasarımcı artık yanıt veremiyor; konuşma salt okunur.')
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
        throw new ForbiddenError('Yalnız müşteri hesapları tasarımcıya soru sorabilir.')
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
              audience: 'customer',
              body,
              createdAt: now,
            },
            select: { id: true },
          })
          const notifyThread = await tx.productQuestionThread.findUniqueOrThrow({
            where: { id: thread.id },
            select: NOTIFY_SELECT,
          })
          await recordTurnNotification(tx, notifyThread, 'customer', body, message.id)
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
        where: { id: lastSeenMessageId, threadId, ...visibleMessageWhere(viewer.role), thread: ownershipWhere(viewer) },
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
      return toThreadDto(thread, true, 'customer')
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
        ...toThreadDto(thread, true, 'seller'),
        customerName: 'Hanuja',
      }
    },

    async replyAsAdmin(params: { threadId: string; adminId: string; audience: 'customer' | 'seller'; body: string }) {
      const body = prepareQuestionMessageBody(params.body)
      return prisma.$transaction(async (tx) => {
        const locked = await tx.productQuestionThread.update({
          where: { id: params.threadId },
          data: { messageSeq: { increment: 1 }, turnSeq: { increment: 1 } },
          select: { messageSeq: true },
        })
        const seq = locked.messageSeq
        const message = await tx.productQuestionMessage.create({
          data: { threadId: params.threadId, seq, authorId: params.adminId, authorRole: 'admin', audience: params.audience, body },
        })
        const thread = await tx.productQuestionThread.update({
          where: { id: params.threadId },
          data: { lastMessageAt: new Date(), ...(params.audience === 'customer' ? { lastSellerMessageSeq: seq, status: 'waiting_for_customer' } : { lastCustomerMessageSeq: seq }) },
          select: NOTIFY_SELECT,
        })
        const customer = params.audience === 'customer'
        await recordNotification(tx, {
          eventKey: 'product-question:' + thread.id + ':admin-reply:' + message.id,
          userId: customer ? thread.customerId : thread.seller.userId,
          emailTo: customer ? thread.customer.email : thread.seller.user.email,
          type: customer ? 'customer_product_question_answered' : 'seller_product_question',
          title: 'Hanuja ürün sorusu yanıtı',
          body: 'Hanuja, ' + thread.product.name + ' hakkında mesaj gönderdi.',
          data: { threadId: thread.id, sellerId: thread.seller.id, sellerName: 'Hanuja', customerName: customer ? thread.customer.name : 'Hanuja', productName: thread.product.name, messageExcerpt: excerpt(body), threadUrl: customerThreadUrl(thread.id), panelUrl: sellerThreadUrl(thread.id) },
        })
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: params.adminId, actionType: 'product_question_viewed', targetType: 'product_question_thread', targetId: params.threadId, newData: { operation: 'reply', audience: params.audience },
        })
        return message
      })
    },

    async countUnreadForSeller(sellerId: string) {
      return prisma.productQuestionThread.count({
        where: {
          sellerId,
          lastCustomerMessageSeq: { gt: prisma.productQuestionThread.fields.sellerLastReadSeq },
        },
      })
    },

    async countPendingForAdmin() {
      return prisma.productQuestionThread.count({ where: { status: 'waiting_for_seller' } })
    },

    async completeAdminReview(params: { threadId: string; adminId: string; lastSeenMessageId: string }) {
      return prisma.$transaction(async (tx) => {
        // Acquire the same row lock as message writers without allocating a message sequence.
        const locked = await tx.productQuestionThread.update({
          where: { id: params.threadId },
          data: { messageSeq: { increment: 0 } },
          select: { status: true, messageSeq: true, lastSellerMessageSeq: true },
        }).catch((error: unknown) => {
          if ((error as { code?: string })?.code === 'P2025') throw new NotFoundError('Soru')
          throw error
        })
        const [seen, customer] = await Promise.all([
          tx.productQuestionMessage.findFirst({
            where: { id: params.lastSeenMessageId, threadId: params.threadId, seq: locked.messageSeq },
            select: { id: true },
          }),
          tx.productQuestionMessage.findFirst({
            where: { threadId: params.threadId, authorRole: 'customer' },
            orderBy: { seq: 'desc' },
            select: { seq: true },
          }),
        ])
        if (!seen) throw new ConflictError('Yeni mesaj geldi. Güncel konuşmayı inceleyin.')
        if (!canCompleteProductQuestionReview(locked, customer?.seq ?? 0)) {
          throw new ConflictError('Son müşteri mesajı yanıtlanmadan inceleme tamamlanamaz.')
        }
        await tx.productQuestionThread.update({
          where: { id: params.threadId },
          data: { status: 'waiting_for_customer' },
        })
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: params.adminId,
          actionType: 'product_question_viewed',
          targetType: 'product_question_thread',
          targetId: params.threadId,
          newData: { operation: 'review_complete', lastSeenMessageId: params.lastSeenMessageId },
        })
        return { status: 'waiting_for_customer' as const }
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
          orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
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
          lastMessageAuthorRole: row.messages[0]?.authorRole ?? null,
        })),
      }
    },

    /** Admin view; every read writes an audit entry in the same transaction. */
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
          ...toThreadDto(thread, true),
          messages: thread.messages.map((message) => ({
            id: message.id,
            authorRole: message.authorRole,
            audience: message.audience,
            body: message.body,
            createdAt: message.createdAt.toISOString(),
          })),
          canCompleteReview: canCompleteProductQuestionReview(
            thread,
            thread.messages.filter((message) => message.authorRole === 'customer').at(-1)?.seq ?? 0,
          ),
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
