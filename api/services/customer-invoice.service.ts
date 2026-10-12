/**
 * Hanuja'nın müşteriye kestiği satış faturası — satıcı Hanuja modeli.
 *
 * İlk aşamada fatura Uyumsoft'ta manuel kesilir; admin PDF'i siparişe yükler. Müşteri yalnız
 * kendi siparişinin faturasını görür. Satıcının Hanuja'ya kestiği alış faturası ayrı tutulur ve
 * müşteriye hiçbir yoldan gösterilmez (order-document.service.ts).
 *
 * Dosyalar satıcı faturalarıyla aynı şifreli özel depoda durur; değiştirme/kaldırma aynı
 * sürüm (If-Match), denetim ve PrivateDocumentCleanup kalıbını izler.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { DOCUMENT_ALLOWED_MIME_TYPES, DOCUMENT_MAX_SIZE_BYTES } from '../lib/r2'
import {
  createPrivateDocumentStorage,
  type PrivateDocumentStorage,
} from '../lib/private-document-storage'
import { assertInvoiceRevision, getInvoiceRevision, validateInvoiceReason } from '../lib/invoice-management'
import { getCustomerInvoiceUrl, getCustomerOrderUrl } from '../lib/platform-info'
import { formatOrderNumber } from '../lib/order-number'
import { EMAIL_LINE_IMAGE_SELECT, toEmailOrderLine } from '../lib/email-line-items'
import { SELLER_VISIBLE_PAYMENT_WHERE } from '../repositories/order.repository'
import { recordNotification } from './notification-outbox.service'
import { processPrivateDocumentCleanup, schedulePrivateDocumentCleanup } from './private-document-cleanup.service'

interface CustomerInvoiceServiceDeps {
  prisma: PrismaClient
  storage?: PrivateDocumentStorage
}

export interface CustomerInvoiceUploadParams {
  orderId: string
  actorId: string
  fileName: string
  mimeType: string
  body: Uint8Array
  invoiceNumber?: string | null
  expectedRevision?: string | null
  reason?: string | null
}

export interface CustomerInvoiceRemoveParams {
  orderId: string
  actorId: string
  expectedRevision?: string | null
  reason?: string | null
}

const INVOICE_NUMBER_PATTERN = /^[\p{L}\p{N} ._/-]{1,64}$/u

const summarySelect = {
  id: true,
  orderId: true,
  invoiceNumber: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
} as const

function validateFile(mimeType: string, sizeBytes: number) {
  if (!DOCUMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ValidationError('Fatura dosyası PDF, JPEG, PNG veya WEBP olmalıdır.')
  }
  if (sizeBytes <= 0) throw new ValidationError('Boş dosya yüklenemez.')
  if (sizeBytes > DOCUMENT_MAX_SIZE_BYTES) throw new ValidationError('Dosya boyutu 20 MB limitini aşıyor.')
}

function normalizeInvoiceNumber(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  if (!INVOICE_NUMBER_PATTERN.test(trimmed)) {
    throw new ValidationError('Fatura numarası 1-64 karakter olmalı; harf, rakam, boşluk ve . _ / - içerebilir.')
  }
  return trimmed
}

async function lockCustomerInvoice(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-invoice:${orderId}`}, 0))`
}

function auditData(invoice: { id: string; fileKey: string; fileName: string; mimeType: string; sizeBytes: number; invoiceNumber: string | null }) {
  return {
    invoiceId: invoice.id, fileName: invoice.fileName, mimeType: invoice.mimeType,
    sizeBytes: invoice.sizeBytes, invoiceNumber: invoice.invoiceNumber,
    revision: getInvoiceRevision(invoice),
  }
}

/** "Faturanız Oluşturuldu"; a replacement is a new event so the customer sees the corrected file. */
async function recordCustomerInvoiceNotification(
  tx: Pick<Prisma.TransactionClient, 'order' | 'notificationOutbox'>,
  orderId: string,
  revision: string,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      publicNumber: true,
      customerId: true,
      customer: { select: { email: true, name: true } },
      address: { select: { fullName: true } },
      lines: {
        select: {
          productName: true,
          variantName: true,
          unitPrice: true,
          totalPrice: true,
          quantity: true,
          cancelledQuantity: true,
          product: { select: EMAIL_LINE_IMAGE_SELECT },
        },
      },
    },
  })
  if (!order) return
  await recordNotification(tx, {
    eventKey: `customer-invoice:${orderId}:${revision}`,
    userId: order.customerId,
    type: 'invoice_uploaded',
    title: 'Faturanız oluşturuldu',
    body: 'Siparişinizin faturası oluşturuldu.',
    data: {
      orderId,
      invoiceRevision: revision,
      customerName: order.customer.name?.trim() || order.address?.fullName?.trim() || 'Değerli Müşterimiz',
      orderNumber: formatOrderNumber(order.publicNumber, order.id),
      orderUrl: getCustomerOrderUrl(orderId),
      invoiceUrl: getCustomerInvoiceUrl(orderId),
      items: order.lines
        .filter((line) => line.quantity - line.cancelledQuantity > 0)
        .map((line) =>
          toEmailOrderLine(line, line.quantity - line.cancelledQuantity, {
            lineTotal: line.totalPrice.div(line.quantity).mul(line.quantity - line.cancelledQuantity),
          }),
        ),
    },
    ...(order.customer.email ? { emailTo: order.customer.email } : {}),
  })
}

export function createCustomerInvoiceService({ prisma, storage: providedStorage }: CustomerInvoiceServiceDeps) {
  let resolvedStorage = providedStorage
  const storage = () => (resolvedStorage ??= createPrivateDocumentStorage())

  async function assertAdmin(actorId: string) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } })
    if (actor?.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')
  }

  async function cleanupNow(fileKey: string) {
    try {
      await processPrivateDocumentCleanup({ prisma, fileKey, deleteFile: (key) => storage().delete(key) })
    } catch (error) {
      console.error('[customer-invoice-cleanup] Immediate cleanup deferred', error)
    }
  }

  async function cleanupUncommitted(fileKey: string) {
    try {
      // A lost COMMIT response does not prove rollback; cleanup re-checks active references.
      await schedulePrivateDocumentCleanup(prisma, fileKey)
      await cleanupNow(fileKey)
    } catch (error) {
      console.error('[customer-invoice-cleanup] Staged file cleanup could not be recorded', error)
    }
  }

  async function getForAdmin(orderId: string, actorId: string) {
    await assertAdmin(actorId)
    const invoice = await prisma.orderCustomerInvoice.findUnique({
      where: { orderId },
      select: { ...summarySelect, fileKey: true },
    })
    if (!invoice) return null
    const { fileKey: _fileKey, ...summary } = invoice
    return { ...summary, revision: getInvoiceRevision(invoice) }
  }

  async function getFileForAdmin(orderId: string, actorId: string) {
    await assertAdmin(actorId)
    const invoice = await prisma.orderCustomerInvoice.findUnique({
      where: { orderId },
      select: { fileKey: true, fileName: true, mimeType: true, sizeBytes: true },
    })
    if (!invoice) throw new NotFoundError('Fatura')
    return invoice
  }

  async function uploadForAdmin(params: CustomerInvoiceUploadParams) {
    validateFile(params.mimeType, params.body.byteLength)
    const invoiceNumber = normalizeInvoiceNumber(params.invoiceNumber)
    await assertAdmin(params.actorId)
    const paidOrder = await prisma.order.findFirst({
      where: { id: params.orderId, AND: [SELLER_VISIBLE_PAYMENT_WHERE] },
      select: { id: true },
    })
    if (!paidOrder) throw new ValidationError('Ödemesi onaylanmamış siparişe fatura yüklenemez.')

    const uploaded = await storage().write(params.body)
    let obsoleteKey: string | null = null
    let result: Awaited<ReturnType<typeof saveUpload>>

    async function saveUpload() {
      return prisma.$transaction(async (tx) => {
        await lockCustomerInvoice(tx, params.orderId)
        const current = await tx.orderCustomerInvoice.findUnique({ where: { orderId: params.orderId } })
        assertInvoiceRevision(current, params.expectedRevision)
        const reason = current
          ? validateInvoiceReason(params.reason)
          : params.reason?.trim() || 'Müşteri faturası ilk kez yüklendi.'
        const data = {
          fileUrl: 'private://customer-invoice',
          fileKey: uploaded.key,
          fileName: params.fileName,
          mimeType: params.mimeType,
          sizeBytes: params.body.byteLength,
          invoiceNumber,
          uploadedAt: new Date(),
          uploadedByAdminId: params.actorId,
        }
        const saved = await tx.orderCustomerInvoice.upsert({
          where: { orderId: params.orderId },
          create: { orderId: params.orderId, ...data },
          update: data,
        })
        if (current && current.fileKey !== uploaded.key) {
          await schedulePrivateDocumentCleanup(tx, current.fileKey)
          obsoleteKey = current.fileKey
        }
        await tx.adminAuditLog.create({ data: {
          actorId: params.actorId,
          actionType: current ? 'customer_invoice_replaced' : 'customer_invoice_uploaded',
          targetType: 'order', targetId: params.orderId, reason,
          ...(current ? { previousData: auditData(current) } : {}),
          newData: auditData(saved),
        } })
        const revision = getInvoiceRevision(saved)
        await recordCustomerInvoiceNotification(tx, params.orderId, revision)
        return {
          id: saved.id, orderId: saved.orderId, invoiceNumber: saved.invoiceNumber,
          fileName: saved.fileName, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes,
          uploadedAt: saved.uploadedAt, revision,
        }
      })
    }

    try {
      result = await saveUpload()
    } catch (error) {
      await cleanupUncommitted(uploaded.key)
      throw error
    }
    if (obsoleteKey) await cleanupNow(obsoleteKey)
    return result
  }

  async function removeForAdmin(params: CustomerInvoiceRemoveParams) {
    const reason = validateInvoiceReason(params.reason)
    await assertAdmin(params.actorId)
    const removed = await prisma.$transaction(async (tx) => {
      await lockCustomerInvoice(tx, params.orderId)
      const current = await tx.orderCustomerInvoice.findUnique({ where: { orderId: params.orderId } })
      assertInvoiceRevision(current, params.expectedRevision)
      if (!current) throw new NotFoundError('Fatura')
      await tx.orderCustomerInvoice.delete({ where: { id: current.id } })
      await tx.adminAuditLog.create({ data: {
        actorId: params.actorId, actionType: 'customer_invoice_removed', targetType: 'order',
        targetId: params.orderId, reason, previousData: auditData(current),
        newData: { removed: true },
      } })
      await schedulePrivateDocumentCleanup(tx, current.fileKey)
      return current
    })
    await cleanupNow(removed.fileKey)
    return { removed: true }
  }

  async function getForCustomer(orderId: string, customerId: string) {
    const invoice = await prisma.orderCustomerInvoice.findFirst({
      where: { orderId, order: { customerId } },
      select: { fileKey: true, fileName: true, mimeType: true, sizeBytes: true },
    })
    if (!invoice) throw new NotFoundError('Fatura')
    return invoice
  }

  function listForCustomer(customerId: string) {
    return prisma.orderCustomerInvoice.findMany({
      where: { order: { customerId } },
      select: {
        ...summarySelect,
        order: { select: { id: true, publicNumber: true, createdAt: true } },
      },
      orderBy: { uploadedAt: 'desc' },
    })
  }

  async function readFile(fileKey: string) {
    const body = await storage().read(fileKey)
    return { body, sizeBytes: body.byteLength }
  }

  return { getForAdmin, getFileForAdmin, uploadForAdmin, removeForAdmin, getForCustomer, listForCustomer, readFile }
}

export type CustomerInvoiceService = ReturnType<typeof createCustomerInvoiceService>
