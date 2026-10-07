import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import {
  deleteObject,
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_MAX_SIZE_BYTES,
  readObject,
} from '../lib/r2'
import {
  createPrivateDocumentStorage,
  isPrivateDocumentStorageKey,
  type PrivateDocumentStorage,
} from '../lib/private-document-storage'
import type { Prisma } from '@prisma/client'
import { recordNotification } from './notification-outbox.service'
import { getWebBaseUrl } from '../lib/platform-info'
import { formatOrderNumber } from '../lib/order-number'
import { EMAIL_LINE_IMAGE_SELECT, toEmailOrderLine } from '../lib/email-line-items'
import { toSellerSafeLegalSnapshot } from '../lib/seller-legal-snapshot'
import { SELLER_VISIBLE_PAYMENT_WHERE } from '../repositories/order.repository'
import {
  assertInvoiceRevision, assertSellerInvoiceWindow, getInvoiceRevision,
  invoiceEditDeadline, isInvoiceManagementEnabled, requireInvoiceManagement,
  validateInvoiceReason,
} from '../lib/invoice-management'
import { processPrivateDocumentCleanup, schedulePrivateDocumentCleanup } from './private-document-cleanup.service'

interface OrderDocumentServiceDeps {
  prisma: PrismaClient
  storage?: PrivateDocumentStorage
}

interface InvoiceActorParams {
  orderId: string
  sellerId: string
  actorId: string
  expectedRevision?: string | null
  reason?: string | null
}

interface InvoiceUploadParams extends InvoiceActorParams {
  fileName: string
  mimeType: string
  sizeBytes: number
  body: Uint8Array
}

export interface InboundInvoiceAttachment {
  fileName: string
  mimeType: string
  body: Uint8Array
}

export interface InboundInvoiceEmail {
  messageId: string
  recipients: string[]
  fromEmail?: string | null
  subject?: string | null
  loadAttachment: () => Promise<InboundInvoiceAttachment | null>
}

const SELLER_HIDDEN_ORDER_STATUSES = [
  'draft',
  'checkout_started',
  'payment_pending',
  'payment_failed',
  'payment_cancelled',
  'bank_transfer_waiting',
] as const

const legalSnapshotSelect = {
  distanceSalesHtml: true,
  preInformationHtml: true,
} as const

const invoiceSummarySelect = {
  id: true,
  orderId: true,
  sellerId: true,
  fileUrl: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  source: true,
  uploadedAt: true,
  seller: {
    select: {
      id: true,
      displayName: true,
      slug: true,
    },
  },
} as const

const invoiceWriteSelect = { ...invoiceSummarySelect, fileKey: true, createdAt: true } as const

async function lockInvoicePair(tx: Prisma.TransactionClient, orderId: string, sellerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([orderId, sellerId])}, 0))`
}

async function findInvoiceState(tx: Prisma.TransactionClient, orderId: string, sellerId: string) {
  const where = { orderId_sellerId: { orderId, sellerId } }
  const current = await tx.orderSellerInvoice.findUnique({ where })
  let policy = await tx.orderSellerInvoicePolicy.findUnique({ where })
  // Covers records created by an older app during an additive rolling release.
  if (!policy && current) {
    policy = await tx.orderSellerInvoicePolicy.upsert({
      where,
      create: { orderId, sellerId, firstUploadedAt: current.createdAt },
      update: {},
    })
  }
  return { current, policy }
}

function invoiceAuditData(invoice: { id: string; fileKey: string; fileName: string; mimeType: string; sizeBytes: number; source: string; sellerId: string }) {
  return {
    invoiceId: invoice.id, sellerId: invoice.sellerId,
    fileName: invoice.fileName, mimeType: invoice.mimeType,
    sizeBytes: invoice.sizeBytes, source: invoice.source,
    revision: getInvoiceRevision(invoice),
  }
}

function toManagementInvoice(invoice: { id: string; fileKey: string; fileName: string; mimeType: string; uploadedAt: Date } | null) {
  return invoice ? {
    id: invoice.id, fileName: invoice.fileName, mimeType: invoice.mimeType,
    uploadedAt: invoice.uploadedAt, revision: getInvoiceRevision(invoice),
  } : null
}

interface PostmarkInboundAttachment {
  Name?: string
  ContentType?: string
  ContentLength?: number
  Content?: string
}

interface PostmarkInboundPayload {
  MessageID?: string
  MessageId?: string
  From?: string
  FromFull?: { Email?: string }
  To?: string
  ToFull?: Array<{ Email?: string }>
  Subject?: string
  Attachments?: PostmarkInboundAttachment[]
}

function validateInvoiceFile(mimeType: string, sizeBytes: number) {
  if (!DOCUMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ValidationError('Fatura dosyası PDF, JPEG, PNG veya WEBP olmalıdır.')
  }

  if (sizeBytes <= 0) {
    throw new ValidationError('Boş dosya yüklenemez.')
  }

  if (sizeBytes > DOCUMENT_MAX_SIZE_BYTES) {
    throw new ValidationError('Dosya boyutu 20 MB limitini aşıyor.')
  }
}

function getInboundEmailDomain() {
  return process.env['INBOUND_EMAIL_DOMAIN']?.trim() || 'fatura.hanuja.com.tr'
}

export function isInvoiceAliasingEnabled() {
  return (process.env['INVOICE_ALIASING_ENABLED'] ?? 'true').trim().toLowerCase() !== 'false'
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function buildOrderUrl(orderId: string) {
  return `${getWebBaseUrl()}/siparis/${orderId}`
}

function buildInvoiceUrl(orderId: string, sellerId: string) {
  return `${getWebBaseUrl()}/api/orders/${orderId}/documents/invoices/${sellerId}`
}

/**
 * "Faturanız Oluşturuldu" for the customer. Written through the caller's
 * transaction client; a re-upload (replace) is a new event on purpose so the
 * customer learns the invoice changed.
 */
async function recordInvoiceUploadedNotification(
  tx: Pick<Prisma.TransactionClient, 'order' | 'seller' | 'notificationOutbox'>,
  params: { orderId: string; sellerId: string; uploadedAt: Date; invoiceRevision: string },
) {
  const [order, seller] = await Promise.all([
    tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        publicNumber: true,
        customerId: true,
        customer: { select: { email: true, name: true } },
        address: { select: { fullName: true } },
        lines: {
          where: { sellerId: params.sellerId },
          select: {
            productName: true,
            variantName: true,
            sellerId: true,
            unitPrice: true,
            totalPrice: true,
            quantity: true,
            cancelledQuantity: true,
            product: { select: EMAIL_LINE_IMAGE_SELECT },
          },
        },
      },
    }),
    tx.seller.findUnique({ where: { id: params.sellerId }, select: { displayName: true } }),
  ])
  if (!order) return
  await recordNotification(tx, {
    eventKey: `invoice:${params.orderId}:${params.sellerId}:${params.invoiceRevision}`,
    userId: order.customerId,
    type: 'invoice_uploaded',
    title: 'Faturanız oluşturuldu',
    body: 'Siparişiniz için satıcı faturası yüklendi.',
    data: {
      orderId: params.orderId,
      sellerId: params.sellerId,
      invoiceRevision: params.invoiceRevision,
      uploadedAt: params.uploadedAt.toISOString(),
      ...(seller ? { sellerName: seller.displayName } : {}),
      customerName:
        order.customer.name?.trim() || order.address?.fullName?.trim() || 'Değerli Müşterimiz',
      orderNumber: formatOrderNumber(order.publicNumber, order.id),
      orderUrl: buildOrderUrl(params.orderId),
      invoiceUrl: buildInvoiceUrl(params.orderId, params.sellerId),
      items: order.lines
        .filter((line) => line.quantity - line.cancelledQuantity > 0)
        .map((line) =>
          toEmailOrderLine(line, line.quantity - line.cancelledQuantity, {
            lineTotal: line.totalPrice
              .div(line.quantity)
              .mul(line.quantity - line.cancelledQuantity),
          }),
        ),
    },
    ...(order.customer.email ? { emailTo: order.customer.email } : {}),
  })
}

function buildAliasEmail(localPart: string) {
  return `${localPart}@${getInboundEmailDomain()}`.toLowerCase()
}

function makeAliasLocalPart() {
  return `pf${randomBytes(5).toString('hex')}`
}

function getPostmarkRecipients(payload: PostmarkInboundPayload) {
  const recipients = new Set<string>()
  for (const item of payload.ToFull ?? []) {
    const email = normalizeEmail(item.Email)
    if (email) recipients.add(email)
  }
  for (const raw of payload.To?.split(',') ?? []) {
    const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    const email = normalizeEmail(emailMatch?.[0])
    if (email) recipients.add(email)
  }
  return [...recipients]
}

function getPostmarkMessageId(payload: PostmarkInboundPayload) {
  return payload.MessageID ?? payload.MessageId ?? randomBytes(12).toString('hex')
}

function selectInvoiceAttachment(payload: PostmarkInboundPayload) {
  return payload.Attachments?.find(
    (attachment) => attachment.ContentType?.toLowerCase() === 'application/pdf',
  ) ?? null
}

export function createOrderDocumentService({
  prisma,
  storage: providedStorage,
}: OrderDocumentServiceDeps) {
  let resolvedStorage = providedStorage
  const storage = () => (resolvedStorage ??= createPrivateDocumentStorage())

  async function deleteInvoiceFile(fileKey: string) {
    if (isPrivateDocumentStorageKey(fileKey)) {
      await storage().delete(fileKey)
      return
    }
    await deleteObject(fileKey)
  }

  async function readInvoiceFile(fileKey: string) {
    if (!isPrivateDocumentStorageKey(fileKey)) {
      return readObject(fileKey, DOCUMENT_MAX_SIZE_BYTES)
    }
    const body = await storage().read(fileKey)
    return { body, contentType: undefined, sizeBytes: body.byteLength }
  }

  async function createInvoiceAlias(orderId: string, sellerId: string) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const localPart = makeAliasLocalPart()
      try {
        return await prisma.orderEmailAlias.create({
          data: {
            orderId,
            sellerId,
            localPart,
            aliasEmail: buildAliasEmail(localPart),
            purpose: 'invoice',
          },
        })
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          // Another request may have created this order/seller alias concurrently.
          const existing = await prisma.orderEmailAlias.findUnique({
            where: { orderId_sellerId_purpose: { orderId, sellerId, purpose: 'invoice' } },
          })
          if (existing) return existing
          continue
        }
        throw error
      }
    }
    throw new ValidationError('Fatura e-posta adresi üretilemedi. Lütfen tekrar deneyin.')
  }

  async function ensureInvoiceAliasForSeller(orderId: string, sellerId: string) {
    if (!isInvoiceAliasingEnabled()) return null

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        lines: { some: { sellerId } },
        AND: [SELLER_VISIBLE_PAYMENT_WHERE],
        status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
      },
      select: { id: true },
    })
    if (!order) throw new NotFoundError('Sipariş', orderId)

    const existing = await prisma.orderEmailAlias.findUnique({
      where: {
        orderId_sellerId_purpose: {
          orderId,
          sellerId,
          purpose: 'invoice',
        },
      },
    })
    if (existing) return existing

    return createInvoiceAlias(orderId, sellerId)
  }

  async function ensureInvoiceAliasesForOrder(orderId: string) {
    if (!isInvoiceAliasingEnabled()) return []

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        lines: { select: { sellerId: true } },
      },
    })
    if (!order) throw new NotFoundError('Sipariş', orderId)

    const sellerIds = [...new Set(order.lines.map((line) => line.sellerId))]
    return Promise.all(sellerIds.map((sellerId) => ensureInvoiceAliasForSeller(orderId, sellerId)))
  }

  async function getDocumentsForCustomer(orderId: string, customerId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: {
        id: true,
        legalSnapshot: { select: legalSnapshotSelect },
        sellerInvoices: {
          select: invoiceSummarySelect,
          orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    })

    if (!order) throw new NotFoundError('Sipariş', orderId)
    return order
  }

  async function getDocumentsForSeller(orderId: string, sellerId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        lines: { some: { sellerId } },
        status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
      },
      select: {
        id: true,
        legalSnapshot: { select: legalSnapshotSelect },
        sellerInvoices: {
          where: { sellerId },
          select: invoiceSummarySelect,
          orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    })

    if (!order) throw new NotFoundError('Sipariş', orderId)
    if (!order.legalSnapshot) return order

    return {
      ...order,
      legalSnapshot: toSellerSafeLegalSnapshot(order.legalSnapshot),
    }
  }

  async function getDocumentsForAdmin(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        legalSnapshot: { select: legalSnapshotSelect },
        sellerInvoices: {
          select: invoiceSummarySelect,
          orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    })

    if (!order) throw new NotFoundError('Sipariş', orderId)
    return order
  }

  async function listInvoicesForCustomer(customerId: string) {
    return prisma.orderSellerInvoice.findMany({
      where: { order: { customerId } },
      select: {
        id: true,
        orderId: true,
        sellerId: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        source: true,
        uploadedAt: true,
        order: {
          select: {
            id: true,
            createdAt: true,
            status: true,
          },
        },
        seller: {
          select: {
            id: true,
            displayName: true,
            slug: true,
          },
        },
      },
      orderBy: { uploadedAt: 'desc' },
    })
  }

  async function getContractForCustomer(orderId: string, customerId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { legalSnapshot: { select: legalSnapshotSelect } },
    })

    if (!order) throw new NotFoundError('Sipariş', orderId)
    if (!order.legalSnapshot) throw new NotFoundError('Sözleşme')
    return order.legalSnapshot
  }

  async function getContractForSeller(orderId: string, sellerId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        lines: { some: { sellerId } },
        status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
      },
      select: { legalSnapshot: { select: legalSnapshotSelect } },
    })

    if (!order) throw new NotFoundError('Sipariş', orderId)
    if (!order.legalSnapshot) throw new NotFoundError('Sözleşme')
    return toSellerSafeLegalSnapshot(order.legalSnapshot)
  }

  async function getContractForAdmin(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { legalSnapshot: { select: legalSnapshotSelect } },
    })

    if (!order) throw new NotFoundError('Sipariş', orderId)
    if (!order.legalSnapshot) throw new NotFoundError('Sözleşme')
    return order.legalSnapshot
  }

  async function getInvoiceForCustomer(orderId: string, customerId: string, sellerId: string) {
    const invoice = await prisma.orderSellerInvoice.findFirst({
      where: {
        orderId,
        sellerId,
        order: { customerId },
      },
      select: {
        fileKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        seller: { select: { id: true, displayName: true } },
      },
    })

    if (!invoice) throw new NotFoundError('Fatura')
    return invoice
  }

  async function getInvoiceForSeller(orderId: string, sellerId: string) {
    const invoice = await prisma.orderSellerInvoice.findFirst({
      where: {
        orderId,
        sellerId,
        order: {
          lines: { some: { sellerId } },
          status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
        },
      },
      select: {
        fileKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        seller: { select: { id: true, displayName: true } },
      },
    })

    if (!invoice) throw new NotFoundError('Fatura')
    return invoice
  }

  async function getInvoiceForAdmin(orderId: string, sellerId: string) {
    const invoice = await prisma.orderSellerInvoice.findFirst({
      where: { orderId, sellerId },
      select: {
        fileKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        seller: { select: { id: true, displayName: true } },
      },
    })

    if (!invoice) throw new NotFoundError('Fatura')
    return invoice
  }

  async function authorizeInvoiceActor(db: Pick<Prisma.TransactionClient, 'seller' | 'user' | 'order'>, params: InvoiceActorParams, role: 'seller' | 'admin') {
    if (role === 'admin') {
      const actor = await db.user.findUnique({ where: { id: params.actorId }, select: { role: true } })
      if (actor?.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')
    } else {
      const seller = await db.seller.findUnique({ where: { id: params.sellerId }, select: { userId: true, status: true } })
      if (!seller || seller.userId !== params.actorId || !['active', 'suspended'].includes(seller.status)) {
        throw new ForbiddenError('Bu satıcının faturalarını yönetme yetkiniz yok.')
      }
    }
    const order = await db.order.findFirst({
      where: {
        id: params.orderId,
        lines: { some: { sellerId: params.sellerId } },
        ...(role === 'seller' ? {
          AND: [SELLER_VISIBLE_PAYMENT_WHERE],
          status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
        } : {}),
      },
      select: { id: true },
    })
    if (!order) throw new NotFoundError('Sipariş', params.orderId)
  }

  async function cleanupNow(fileKey: string) {
    try {
      await processPrivateDocumentCleanup({ prisma, fileKey, deleteFile: deleteInvoiceFile })
    } catch (error) {
      // The durable intent remains available to the worker after a successful commit.
      console.error('[invoice-cleanup] Immediate cleanup deferred', error)
    }
  }

  async function cleanupUncommitted(fileKey: string) {
    try {
      // A lost COMMIT response does not prove rollback. The cleanup service checks
      // active references before deleting, including for apparently failed writes.
      await schedulePrivateDocumentCleanup(prisma, fileKey)
      await cleanupNow(fileKey)
    } catch (error) {
      console.error('[invoice-cleanup] Staged file cleanup could not be recorded', error)
    }
  }

  async function getInvoiceManagementForSeller(orderId: string, sellerId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId, lines: { some: { sellerId } }, AND: [SELLER_VISIBLE_PAYMENT_WHERE],
        status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
      },
      select: { id: true },
    })
    if (!order) throw new NotFoundError('Sipariş', orderId)
    const where = { orderId_sellerId: { orderId, sellerId } }
    const [invoice, policy] = await Promise.all([
      prisma.orderSellerInvoice.findUnique({ where }),
      prisma.orderSellerInvoicePolicy.findUnique({ where }),
    ])
    const firstUploadedAt = policy?.firstUploadedAt ?? invoice?.createdAt ?? null
    const sellerEditDeadline = invoiceEditDeadline(firstUploadedAt)
    return {
      invoice: toManagementInvoice(invoice), firstUploadedAt, sellerEditDeadline,
      canEdit: !sellerEditDeadline || new Date() < sellerEditDeadline,
      managementEnabled: isInvoiceManagementEnabled(),
    }
  }

  async function getInvoiceManagementForAdmin(orderId: string, actorId: string) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } })
    if (actor?.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        lines: { select: { seller: { select: { id: true, displayName: true } } } },
        sellerInvoices: true,
      },
    })
    if (!order) throw new NotFoundError('Sipariş', orderId)
    const sellers = [...new Map(order.lines.map(line => [line.seller.id, line.seller])).values()]
    return {
      managementEnabled: isInvoiceManagementEnabled(),
      sellers: sellers.map(seller => ({
        sellerId: seller.id, sellerName: seller.displayName,
        invoice: toManagementInvoice(order.sellerInvoices.find(invoice => invoice.sellerId === seller.id) ?? null),
      })),
    }
  }

  async function uploadInvoice(params: InvoiceUploadParams, role: 'seller' | 'admin') {
    if (role === 'admin') requireInvoiceManagement()
    validateInvoiceFile(params.mimeType, params.sizeBytes)
    validateInvoiceFile(params.mimeType, params.body.byteLength)
    await authorizeInvoiceActor(prisma, params, role)
    const uploaded = await storage().write(params.body)
    let obsoleteKey: string | null = null
    let invoice: Prisma.OrderSellerInvoiceGetPayload<{ select: typeof invoiceWriteSelect }> & { revision: string }
    try {
      const saved = await prisma.$transaction(async tx => {
        await lockInvoicePair(tx, params.orderId, params.sellerId)
        await authorizeInvoiceActor(tx, params, role)
        const { current, policy } = await findInvoiceState(tx, params.orderId, params.sellerId)
        const uploadedAt = new Date()
        if (role === 'seller') assertSellerInvoiceWindow(policy?.firstUploadedAt ?? null, uploadedAt)
        assertInvoiceRevision(current, params.expectedRevision)
        const reason = current ? validateInvoiceReason(params.reason) : (params.reason?.trim() || 'Fatura ilk kez yüklendi.')
        await tx.orderSellerInvoicePolicy.upsert({
          where: { orderId_sellerId: { orderId: params.orderId, sellerId: params.sellerId } },
          create: { orderId: params.orderId, sellerId: params.sellerId, firstUploadedAt: uploadedAt },
          update: {},
        })
        const data = {
          fileUrl: 'private://seller-invoice', fileKey: uploaded.key,
          fileName: params.fileName, mimeType: params.mimeType, sizeBytes: params.body.byteLength,
          source: 'manual', inboundEmailId: null, uploadedAt,
        }
        const saved = await tx.orderSellerInvoice.upsert({
          where: { orderId_sellerId: { orderId: params.orderId, sellerId: params.sellerId } },
          create: { orderId: params.orderId, sellerId: params.sellerId, ...data },
          update: data, select: invoiceWriteSelect,
        })
        if (current && current.fileKey !== uploaded.key) {
          await schedulePrivateDocumentCleanup(tx, current.fileKey)
          obsoleteKey = current.fileKey
        }
        await tx.adminAuditLog.create({ data: {
          actorId: params.actorId, actionType: current ? 'order_invoice_replaced' : 'order_invoice_uploaded',
          targetType: 'order', targetId: params.orderId, reason,
          ...(current ? { previousData: invoiceAuditData(current) } : {}),
          newData: { ...invoiceAuditData(saved), actorRole: role },
        } })
        const revision = getInvoiceRevision(saved)
        await recordInvoiceUploadedNotification(tx, { orderId: params.orderId, sellerId: params.sellerId, uploadedAt, invoiceRevision: revision })
        return { ...saved, revision }
      })
      invoice = saved
    } catch (error) {
      await cleanupUncommitted(uploaded.key)
      throw error
    }
    if (obsoleteKey) await cleanupNow(obsoleteKey)
    const { fileKey: _fileKey, createdAt: _createdAt, ...summary } = invoice
    return summary
  }

  async function removeInvoice(params: InvoiceActorParams, role: 'seller' | 'admin') {
    requireInvoiceManagement()
    const reason = validateInvoiceReason(params.reason)
    const removed = await prisma.$transaction(async tx => {
      await lockInvoicePair(tx, params.orderId, params.sellerId)
      await authorizeInvoiceActor(tx, params, role)
      const { current, policy } = await findInvoiceState(tx, params.orderId, params.sellerId)
      if (role === 'seller') assertSellerInvoiceWindow(policy?.firstUploadedAt ?? null)
      assertInvoiceRevision(current, params.expectedRevision)
      if (!current) throw new NotFoundError('Fatura')
      await tx.orderSellerInvoice.delete({ where: { id: current.id } })
      await tx.adminAuditLog.create({ data: {
        actorId: params.actorId, actionType: 'order_invoice_removed', targetType: 'order',
        targetId: params.orderId, reason, previousData: invoiceAuditData(current),
        newData: { sellerId: params.sellerId, actorRole: role, removed: true },
      } })
      await schedulePrivateDocumentCleanup(tx, current.fileKey)
      return current
    })
    await cleanupNow(removed.fileKey)
    return { removed: true }
  }

  const uploadInvoiceForSeller = (params: InvoiceUploadParams) => uploadInvoice(params, 'seller')
  const uploadInvoiceForAdmin = (params: InvoiceUploadParams) => uploadInvoice(params, 'admin')
  const removeInvoiceForSeller = (params: InvoiceActorParams) => removeInvoice(params, 'seller')
  const removeInvoiceForAdmin = (params: InvoiceActorParams) => removeInvoice(params, 'admin')

  async function processInboundInvoiceEmail(payload: InboundInvoiceEmail) {
    const messageId = payload.messageId
    const existingInbound = await prisma.inboundEmail.findUnique({ where: { messageId } })
    if (existingInbound) {
      return { status: 'duplicate' as const, inboundEmail: existingInbound }
    }

    const recipients = [...new Set(payload.recipients.map(normalizeEmail).filter(Boolean))]
    const aliases = await prisma.orderEmailAlias.findMany({
      where: {
        aliasEmail: { in: recipients },
        purpose: 'invoice',
        status: 'active',
        order: {
          AND: [SELLER_VISIBLE_PAYMENT_WHERE],
          status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
        },
      },
      take: 2,
    })
    const alias = aliases.length === 1 ? aliases[0] : null

    if (!alias) {
      const inboundEmail = await prisma.inboundEmail.create({
        data: {
          messageId,
          aliasEmail: recipients[0] ?? '',
          fromEmail: payload.fromEmail ?? null,
          subject: payload.subject ?? null,
          status: aliases.length ? 'ambiguous_alias' : 'unknown_alias',
          errorReason: aliases.length ? 'Multiple invoice aliases' : 'Alias not found',
        },
      })
      return { status: aliases.length ? 'ambiguous_alias' as const : 'unknown_alias' as const, inboundEmail }
    }

    let attachment: InboundInvoiceAttachment | null = null
    let invalidAttachment = false
    try {
      attachment = await payload.loadAttachment()
      if (attachment) {
        validateInvoiceFile(attachment.mimeType, attachment.body.byteLength)
        if (attachment.mimeType !== 'application/pdf' ||
            Buffer.from(attachment.body.subarray(0, 5)).toString('ascii') !== '%PDF-') {
          throw new ValidationError('Geçerli bir PDF fatura eki bulunamadı.')
        }
      }
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      attachment = null
      invalidAttachment = true
    }
    if (!attachment) {
      const inboundEmail = await prisma.inboundEmail.create({
        data: {
          messageId,
          orderId: alias.orderId,
          sellerId: alias.sellerId,
          aliasEmail: alias.aliasEmail,
          fromEmail: payload.fromEmail ?? null,
          subject: payload.subject ?? null,
          status: 'no_valid_attachment',
          errorReason: invalidAttachment ? 'Invalid PDF or attachment size' : 'No PDF invoice attachment found',
        },
      })
      await prisma.orderEmailAlias.update({
        where: { id: alias.id },
        data: { lastInboundAt: new Date() },
      })
      return { status: 'no_valid_attachment' as const, inboundEmail }
    }

    const { mimeType, fileName, body } = attachment
    const sizeBytes = body.byteLength

    const uploaded = await storage().write(body)
    let cleanupKey: string | null = null

    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockInvoicePair(tx, alias.orderId, alias.sellerId)
        const duplicate = await tx.inboundEmail.findUnique({ where: { messageId } })
        if (duplicate) {
          await schedulePrivateDocumentCleanup(tx, uploaded.key)
          cleanupKey = uploaded.key
          return { status: 'duplicate' as const, inboundEmail: duplicate }
        }
        const { current, policy } = await findInvoiceState(tx, alias.orderId, alias.sellerId)
        const uploadedAt = new Date()
        const deadline = invoiceEditDeadline(policy?.firstUploadedAt ?? null)
        const blocked = !!deadline && uploadedAt >= deadline
        const inboundEmail = await tx.inboundEmail.create({
          data: {
            messageId,
            orderId: alias.orderId,
            sellerId: alias.sellerId,
            aliasEmail: alias.aliasEmail,
            fromEmail: payload.fromEmail ?? null,
            subject: payload.subject ?? null,
            status: blocked ? 'blocked_invoice_policy' : 'processed',
            errorReason: blocked ? 'Seller invoice correction window expired' : null,
            selectedAttachment: {
              fileName,
              mimeType,
              sizeBytes,
            },
          },
        })

        await tx.orderEmailAlias.update({ where: { id: alias.id }, data: { lastInboundAt: uploadedAt } })
        if (blocked) {
          await schedulePrivateDocumentCleanup(tx, uploaded.key)
          cleanupKey = uploaded.key
          return { status: 'blocked_invoice_policy' as const, inboundEmail }
        }
        await tx.orderSellerInvoicePolicy.upsert({
          where: { orderId_sellerId: { orderId: alias.orderId, sellerId: alias.sellerId } },
          create: { orderId: alias.orderId, sellerId: alias.sellerId, firstUploadedAt: uploadedAt }, update: {},
        })

        const invoice = await tx.orderSellerInvoice.upsert({
          where: {
            orderId_sellerId: {
              orderId: alias.orderId,
              sellerId: alias.sellerId,
            },
          },
          create: {
            orderId: alias.orderId,
            sellerId: alias.sellerId,
            inboundEmailId: inboundEmail.id,
            fileUrl: 'private://seller-invoice',
            fileKey: uploaded.key,
            fileName,
            mimeType,
            sizeBytes,
            source: 'inbound_email',
            uploadedAt,
          },
          update: {
            inboundEmailId: inboundEmail.id,
            fileUrl: 'private://seller-invoice',
            fileKey: uploaded.key,
            fileName,
            mimeType,
            sizeBytes,
            source: 'inbound_email',
            uploadedAt,
          },
          select: invoiceWriteSelect,
        })
        if (current && current.fileKey !== uploaded.key) {
          await schedulePrivateDocumentCleanup(tx, current.fileKey)
          cleanupKey = current.fileKey
        }
        await tx.adminAuditLog.create({ data: {
          actorId: 'system:invoice-inbound', actionType: current ? 'order_invoice_replaced' : 'order_invoice_uploaded',
          targetType: 'order', targetId: alias.orderId, reason: 'Doğrulanmış gelen e-posta olayıyla fatura yüklendi.',
          ...(current ? { previousData: invoiceAuditData(current) } : {}),
          newData: { ...invoiceAuditData(invoice), actorRole: 'system', inboundEmailId: inboundEmail.id },
        } })

        await recordInvoiceUploadedNotification(tx, {
          orderId: alias.orderId,
          sellerId: alias.sellerId,
          uploadedAt,
          invoiceRevision: getInvoiceRevision(invoice),
        })

        const { fileKey: _fileKey, createdAt: _createdAt, ...summary } = invoice
        return { status: 'processed' as const, inboundEmail, invoice: summary }
      })

      if (cleanupKey) await cleanupNow(cleanupKey)
      return result
    } catch (error) {
      await cleanupUncommitted(uploaded.key)
      throw error
    }
  }

  async function ingestInboundInvoiceEmail(payload: InboundInvoiceEmail) {
    try {
      return await processInboundInvoiceEmail(payload)
    } catch (error) {
      // The unique message ID also protects concurrent webhook deliveries.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const inboundEmail = await prisma.inboundEmail.findUnique({
          where: { messageId: payload.messageId },
        })
        if (inboundEmail) return { status: 'duplicate' as const, inboundEmail }
      }
      throw error
    }
  }

  async function ingestPostmarkInboundEmail(payload: PostmarkInboundPayload) {
    return ingestInboundInvoiceEmail({
      messageId: getPostmarkMessageId(payload),
      recipients: getPostmarkRecipients(payload),
      fromEmail: payload.FromFull?.Email ?? payload.From ?? null,
      subject: payload.Subject ?? null,
      loadAttachment: async () => {
        const attachment = selectInvoiceAttachment(payload)
        if (!attachment?.Content) return null
        if (attachment.Content.length > Math.ceil(DOCUMENT_MAX_SIZE_BYTES / 3) * 4) {
          throw new ValidationError('Dosya boyutu 20 MB limitini aşıyor.')
        }
        return {
          fileName: attachment.Name ?? 'fatura.pdf',
          mimeType: 'application/pdf',
          body: new Uint8Array(Buffer.from(attachment.Content, 'base64')),
        }
      },
    })
  }

  return {
    ensureInvoiceAliasForSeller,
    ensureInvoiceAliasesForOrder,
    getDocumentsForCustomer,
    getDocumentsForSeller,
    getDocumentsForAdmin,
    listInvoicesForCustomer,
    getContractForCustomer,
    getContractForSeller,
    getContractForAdmin,
    getInvoiceForCustomer,
    getInvoiceForSeller,
    getInvoiceForAdmin,
    readInvoiceFile,
    uploadInvoiceForSeller,
    uploadInvoiceForAdmin,
    removeInvoiceForSeller,
    removeInvoiceForAdmin,
    getInvoiceManagementForSeller,
    getInvoiceManagementForAdmin,
    ingestInboundInvoiceEmail,
    ingestPostmarkInboundEmail,
  }
}

export type OrderDocumentService = ReturnType<typeof createOrderDocumentService>
