import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
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
import { getSellerOrderUrl } from '../lib/platform-info'
import { formatOrderNumber } from '../lib/order-number'
import { toSellerSafeLegalSnapshot } from '../lib/seller-legal-snapshot'
import { SELLER_VISIBLE_PAYMENT_WHERE } from '../repositories/order.repository'
import {
  APPROVED_SELLER_INVOICE_LOCKED_MESSAGE,
  assertInvoiceRevision, assertSellerInvoiceWindow, getInvoiceRevision,
  invoiceEditDeadline, isInvoiceManagementEnabled, requireInvoiceManagement,
  validateInvoiceReason,
} from '../lib/invoice-management'
import { getReportingDateKey, isReportingDateKey, reportingDayStart } from '../lib/reporting-time'
import { processPrivateDocumentCleanup, schedulePrivateDocumentCleanup } from './private-document-cleanup.service'
import { createPayoutService } from './payout.service'

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

export interface SellerInvoiceReviewParams {
  orderId: string
  sellerId: string
  actorId: string
  expectedRevision: string
  decision: 'approve' | 'reject'
  /** Required when approving: the number printed on the seller's invoice. */
  invoiceNumber?: string | null
  /** Required when approving: the invoice date as a Türkiye calendar day (YYYY-MM-DD). */
  invoiceDate?: string | null
  /** Required when rejecting; shown to the seller. */
  note?: string | null
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
  invoiceNumber: true,
  invoiceDate: true,
  reviewStatus: true,
  reviewedAt: true,
  reviewNote: true,
  seller: {
    select: {
      id: true,
      displayName: true,
      slug: true,
    },
  },
} as const

const invoiceWriteSelect = { ...invoiceSummarySelect, fileKey: true, createdAt: true } as const

// A new file is a new document: the earlier approval and its invoice data no longer apply.
const RESET_INVOICE_REVIEW = {
  invoiceNumber: null,
  invoiceDate: null,
  reviewStatus: 'pending',
  reviewedAt: null,
  reviewedByAdminId: null,
  reviewNote: null,
} as const

const INVOICE_NUMBER_PATTERN = /^[\p{L}\p{N} ._/-]{1,64}$/u

const customerInvoiceSummarySelect = {
  id: true,
  orderId: true,
  invoiceNumber: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
} as const

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

function toManagementInvoice(invoice: {
  id: string; fileKey: string; fileName: string; mimeType: string; uploadedAt: Date
  invoiceNumber: string | null; invoiceDate: Date | null
  reviewStatus: 'pending' | 'approved' | 'rejected'; reviewedAt: Date | null; reviewNote: string | null
} | null) {
  return invoice ? {
    id: invoice.id, fileName: invoice.fileName, mimeType: invoice.mimeType,
    uploadedAt: invoice.uploadedAt, revision: getInvoiceRevision(invoice),
    invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate,
    reviewStatus: invoice.reviewStatus, reviewedAt: invoice.reviewedAt, reviewNote: invoice.reviewNote,
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

/**
 * The seller's invoice to Hanuja is internal (satıcı Hanuja modeli): no customer
 * notification is written for it. Hanuja's own customer invoice notifies the customer
 * from customer-invoice.service.ts.
 */
async function recordSellerInvoiceRejectedNotification(
  tx: Pick<Prisma.TransactionClient, 'order' | 'seller' | 'notificationOutbox'>,
  params: { orderId: string; sellerId: string; invoiceRevision: string; reason: string },
) {
  const [order, seller] = await Promise.all([
    tx.order.findUnique({ where: { id: params.orderId }, select: { id: true, publicNumber: true } }),
    tx.seller.findUnique({
      where: { id: params.sellerId },
      select: { userId: true, displayName: true, user: { select: { email: true } } },
    }),
  ])
  if (!order || !seller) return
  const orderNumber = formatOrderNumber(order.publicNumber, order.id)
  await recordNotification(tx, {
    eventKey: `seller-invoice-rejected:${params.orderId}:${params.sellerId}:${params.invoiceRevision}`,
    userId: seller.userId,
    type: 'seller_invoice_rejected',
    title: 'Faturanız onaylanmadı',
    body: `#${orderNumber} numaralı sipariş için Hanuja'ya kestiğiniz fatura onaylanmadı.`,
    data: {
      orderId: params.orderId,
      sellerId: params.sellerId,
      sellerName: seller.displayName,
      orderNumber,
      reason: params.reason,
      panelUrl: getSellerOrderUrl(params.orderId),
    },
    ...(seller.user.email ? { emailTo: seller.user.email } : {}),
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

  // The customer never sees the seller's invoice to Hanuja, only Hanuja's own invoice.
  async function getDocumentsForCustomer(orderId: string, customerId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: {
        id: true,
        legalSnapshot: { select: legalSnapshotSelect },
        customerInvoice: { select: customerInvoiceSummarySelect },
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
        throw new ForbiddenError('Bu tasarımcının faturalarını yönetme yetkiniz yok.')
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

  /**
   * The payout due date follows the approved invoice. Runs after the invoice change has
   * committed; eligibility re-reads the invoice anyway, so a failed sync never pays early.
   */
  async function syncPayoutDueDate(orderId: string, sellerId: string) {
    try {
      await createPayoutService({ prisma }).syncInvoiceDueDate({ orderId, sellerId })
    } catch (error) {
      console.error('[seller-invoice] Payout due date sync deferred', { orderId, sellerId, error })
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
    let invoice: Prisma.OrderSellerInvoiceGetPayload<{ select: typeof invoiceWriteSelect }> & { revision: string; wasApproved: boolean }
    try {
      const saved = await prisma.$transaction(async tx => {
        await lockInvoicePair(tx, params.orderId, params.sellerId)
        await authorizeInvoiceActor(tx, params, role)
        const { current, policy } = await findInvoiceState(tx, params.orderId, params.sellerId)
        const uploadedAt = new Date()
        if (role === 'seller') {
          if (current?.reviewStatus === 'approved') throw new ForbiddenError(APPROVED_SELLER_INVOICE_LOCKED_MESSAGE)
          assertSellerInvoiceWindow(policy?.firstUploadedAt ?? null, uploadedAt)
        }
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
          source: 'manual', inboundEmailId: null, uploadedAt, ...RESET_INVOICE_REVIEW,
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
        return { ...saved, revision: getInvoiceRevision(saved), wasApproved: current?.reviewStatus === 'approved' }
      })
      invoice = saved
    } catch (error) {
      await cleanupUncommitted(uploaded.key)
      throw error
    }
    if (obsoleteKey) await cleanupNow(obsoleteKey)
    const { fileKey: _fileKey, createdAt: _createdAt, wasApproved, ...summary } = invoice
    // Only an admin can replace an approved invoice; the reset approval clears the due date.
    if (wasApproved) await syncPayoutDueDate(params.orderId, params.sellerId)
    return summary
  }

  async function removeInvoice(params: InvoiceActorParams, role: 'seller' | 'admin') {
    requireInvoiceManagement()
    const reason = validateInvoiceReason(params.reason)
    const removed = await prisma.$transaction(async tx => {
      await lockInvoicePair(tx, params.orderId, params.sellerId)
      await authorizeInvoiceActor(tx, params, role)
      const { current, policy } = await findInvoiceState(tx, params.orderId, params.sellerId)
      if (role === 'seller') {
        if (current?.reviewStatus === 'approved') throw new ForbiddenError(APPROVED_SELLER_INVOICE_LOCKED_MESSAGE)
        assertSellerInvoiceWindow(policy?.firstUploadedAt ?? null)
      }
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
    if (removed.reviewStatus === 'approved') await syncPayoutDueDate(params.orderId, params.sellerId)
    return { removed: true }
  }

  /**
   * Admin review of the seller's invoice to Hanuja. Approval records the invoice number and
   * date (the payout term starts from that date); rejection notifies the seller with a reason.
   * The revision guard ensures the admin decided on the file currently stored.
   */
  async function reviewSellerInvoice(params: SellerInvoiceReviewParams) {
    const actor = await prisma.user.findUnique({ where: { id: params.actorId }, select: { role: true } })
    if (actor?.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')

    let invoiceNumber: string | null = null
    let invoiceDate: Date | null = null
    let note: string | null = null
    if (params.decision === 'approve') {
      invoiceNumber = params.invoiceNumber?.trim() ?? ''
      if (!INVOICE_NUMBER_PATTERN.test(invoiceNumber)) {
        throw new ValidationError('Fatura numarası 1-64 karakter olmalı; harf, rakam, boşluk ve . _ / - içerebilir.')
      }
      const dateKey = params.invoiceDate?.trim() ?? ''
      if (!isReportingDateKey(dateKey)) throw new ValidationError('Geçerli bir fatura tarihi girin.')
      if (dateKey > getReportingDateKey(new Date())) throw new ValidationError('Fatura tarihi ileri bir tarih olamaz.')
      invoiceDate = reportingDayStart(dateKey)
    } else {
      note = validateInvoiceReason(params.note)
    }

    const reviewed = await prisma.$transaction(async tx => {
      await lockInvoicePair(tx, params.orderId, params.sellerId)
      const { current } = await findInvoiceState(tx, params.orderId, params.sellerId)
      if (!current) throw new NotFoundError('Fatura')
      assertInvoiceRevision(current, params.expectedRevision)
      // The approval fixes the payout term; a repeated submission must not move it.
      if (current.reviewStatus === 'approved') {
        throw new ConflictError('Fatura zaten onaylandı. Düzeltme için faturayı kaldırıp yeniden yükleyin.')
      }
      const order = await tx.order.findUnique({
        where: { id: params.orderId },
        select: { paymentConfirmedAt: true, payments: { where: { confirmedAt: { not: null } }, select: { confirmedAt: true } } },
      })
      const paidAt = order?.paymentConfirmedAt ?? order?.payments[0]?.confirmedAt ?? null
      if (invoiceDate && paidAt && getReportingDateKey(invoiceDate) < getReportingDateKey(paidAt)) {
        throw new ValidationError('Fatura tarihi siparişin ödeme tarihinden önce olamaz.')
      }
      const updated = await tx.orderSellerInvoice.update({
        where: { id: current.id },
        data: {
          reviewStatus: params.decision === 'approve' ? 'approved' : 'rejected',
          reviewedAt: new Date(),
          reviewedByAdminId: params.actorId,
          invoiceNumber,
          invoiceDate,
          reviewNote: note,
        },
        select: invoiceWriteSelect,
      })
      const revision = getInvoiceRevision(updated)
      await tx.adminAuditLog.create({ data: {
        actorId: params.actorId,
        actionType: params.decision === 'approve' ? 'seller_invoice_approved' : 'seller_invoice_rejected',
        targetType: 'order', targetId: params.orderId,
        reason: note ?? `Tasarımcı faturası onaylandı: ${invoiceNumber}`,
        previousData: { ...invoiceAuditData(current), reviewStatus: current.reviewStatus },
        newData: {
          sellerId: params.sellerId, revision, reviewStatus: updated.reviewStatus,
          invoiceNumber, invoiceDate: invoiceDate ? getReportingDateKey(invoiceDate) : null,
        },
      } })
      if (params.decision === 'reject') {
        await recordSellerInvoiceRejectedNotification(tx, {
          orderId: params.orderId, sellerId: params.sellerId, invoiceRevision: revision, reason: note!,
        })
      }
      return { ...updated, revision }
    })

    await syncPayoutDueDate(params.orderId, params.sellerId)
    const { fileKey: _fileKey, createdAt: _createdAt, ...summary } = reviewed
    return summary
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
        // An approved invoice fixes the payout term; a later e-mail must not silently reset it.
        const existingInvoice = !!current
        const approved = current?.reviewStatus === 'approved'
        const blocked = existingInvoice || (!!deadline && uploadedAt >= deadline)
        const inboundEmail = await tx.inboundEmail.create({
          data: {
            messageId,
            orderId: alias.orderId,
            sellerId: alias.sellerId,
            aliasEmail: alias.aliasEmail,
            fromEmail: payload.fromEmail ?? null,
            subject: payload.subject ?? null,
            status: blocked ? 'blocked_invoice_policy' : 'processed',
            errorReason: approved
              ? 'Approved seller invoice cannot be replaced by e-mail'
              : existingInvoice ? 'Existing seller invoice cannot be replaced by e-mail'
              : blocked ? 'Seller invoice correction window expired' : null,
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

        const invoice = await tx.orderSellerInvoice.create({
          data: {
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
            ...RESET_INVOICE_REVIEW,
          },
          select: invoiceWriteSelect,
        })
        await tx.adminAuditLog.create({ data: {
          actorId: 'system:invoice-inbound', actionType: 'order_invoice_uploaded',
          targetType: 'order', targetId: alias.orderId, reason: 'Doğrulanmış gelen e-posta olayıyla fatura yüklendi.',
          newData: { ...invoiceAuditData(invoice), actorRole: 'system', inboundEmailId: inboundEmail.id },
        } })

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
    getContractForCustomer,
    getContractForSeller,
    getContractForAdmin,
    getInvoiceForSeller,
    getInvoiceForAdmin,
    readInvoiceFile,
    uploadInvoiceForSeller,
    uploadInvoiceForAdmin,
    removeInvoiceForSeller,
    removeInvoiceForAdmin,
    getInvoiceManagementForSeller,
    getInvoiceManagementForAdmin,
    reviewSellerInvoice,
    ingestInboundInvoiceEmail,
    ingestPostmarkInboundEmail,
  }
}

export type OrderDocumentService = ReturnType<typeof createOrderDocumentService>
