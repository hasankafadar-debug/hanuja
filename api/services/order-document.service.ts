import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  deleteObject,
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_MAX_SIZE_BYTES,
  uploadObject,
} from '../lib/r2'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { getWebBaseUrl } from '../lib/platform-info'

interface OrderDocumentServiceDeps {
  prisma: PrismaClient
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

function isInvoiceAliasingEnabled() {
  return (process.env['INVOICE_ALIASING_ENABLED'] ?? 'true').toLowerCase() !== 'false'
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function buildOrderUrl(orderId: string) {
  return `${getWebBaseUrl()}/siparis/${orderId}`
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
  const attachments = payload.Attachments ?? []
  const allowed = attachments.filter((attachment) => {
    const mimeType = attachment.ContentType?.toLowerCase() ?? ''
    return DOCUMENT_ALLOWED_MIME_TYPES.has(mimeType)
  })
  return (
    allowed.find((attachment) => attachment.ContentType?.toLowerCase() === 'application/pdf') ??
    allowed[0] ??
    null
  )
}

export function createOrderDocumentService({ prisma }: OrderDocumentServiceDeps) {
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
    return order
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
    return order.legalSnapshot
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

  async function uploadInvoiceForSeller(params: {
    orderId: string
    sellerId: string
    fileName: string
    mimeType: string
    sizeBytes: number
    body: Uint8Array
  }) {
    validateInvoiceFile(params.mimeType, params.sizeBytes)

    const order = await prisma.order.findFirst({
      where: {
        id: params.orderId,
        lines: { some: { sellerId: params.sellerId } },
        status: { notIn: [...SELLER_HIDDEN_ORDER_STATUSES] },
      },
      select: {
        id: true,
        customerId: true,
        customer: { select: { email: true, name: true } },
        sellerInvoices: {
          where: { sellerId: params.sellerId },
          select: { fileKey: true },
          take: 1,
        },
      },
    })

    if (!order) throw new NotFoundError('Sipariş', params.orderId)

    const uploaded = await uploadObject({
      folder: 'documents',
      mimeType: params.mimeType,
      ownerId: params.sellerId,
      body: params.body,
    })

    const previousKey = order.sellerInvoices[0]?.fileKey ?? null

    try {
      const invoice = await prisma.orderSellerInvoice.upsert({
        where: {
          orderId_sellerId: {
            orderId: params.orderId,
            sellerId: params.sellerId,
          },
        },
        create: {
          orderId: params.orderId,
          sellerId: params.sellerId,
          fileUrl: uploaded.publicUrl,
          fileKey: uploaded.key,
          fileName: params.fileName,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
          source: 'manual',
          uploadedAt: new Date(),
        },
        update: {
          fileUrl: uploaded.publicUrl,
          fileKey: uploaded.key,
          fileName: params.fileName,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
          source: 'manual',
          uploadedAt: new Date(),
        },
        select: invoiceSummarySelect,
      })

      if (previousKey && previousKey !== uploaded.key) {
        await deleteObject(previousKey).catch(() => null)
      }

      // Notify the customer their invoice is ready. A re-upload (replace) sends
      // again on purpose so the customer knows the invoice changed. Enqueue
      // failure must not fail the upload.
      await enqueueNotification({
        userId: order.customerId,
        type: 'invoice_uploaded',
        title: 'Faturanız hazır',
        body: 'Siparişiniz için satıcı faturası yüklendi.',
        data: {
          orderId: params.orderId,
          sellerId: params.sellerId,
          customerName: order.customer.name ?? '',
          orderNumber: params.orderId.slice(-8).toUpperCase(),
          orderUrl: buildOrderUrl(params.orderId),
        },
        emailTo: order.customer.email,
      }).catch((error) => {
        console.error('[invoice-upload] customer notification failed:', error)
      })

      return invoice
    } catch (error) {
      await deleteObject(uploaded.key).catch(() => null)
      throw error
    }
  }

  async function ingestPostmarkInboundEmail(payload: PostmarkInboundPayload) {
    const messageId = getPostmarkMessageId(payload)
    const existingInbound = await prisma.inboundEmail.findUnique({ where: { messageId } })
    if (existingInbound) {
      return { status: 'duplicate' as const, inboundEmail: existingInbound }
    }

    const recipients = getPostmarkRecipients(payload)
    const alias = await prisma.orderEmailAlias.findFirst({
      where: {
        aliasEmail: { in: recipients },
        purpose: 'invoice',
        status: 'active',
      },
    })

    if (!alias) {
      const inboundEmail = await prisma.inboundEmail.create({
        data: {
          messageId,
          aliasEmail: recipients[0] ?? '',
          fromEmail: payload.FromFull?.Email ?? payload.From ?? null,
          subject: payload.Subject ?? null,
          status: 'unknown_alias',
          errorReason: 'Alias not found',
        },
      })
      return { status: 'unknown_alias' as const, inboundEmail }
    }

    const attachment = selectInvoiceAttachment(payload)
    if (!attachment?.Content || !attachment.ContentType) {
      const inboundEmail = await prisma.inboundEmail.create({
        data: {
          messageId,
          orderId: alias.orderId,
          sellerId: alias.sellerId,
          aliasEmail: alias.aliasEmail,
          fromEmail: payload.FromFull?.Email ?? payload.From ?? null,
          subject: payload.Subject ?? null,
          status: 'no_valid_attachment',
          errorReason: 'No PDF/image invoice attachment found',
        },
      })
      await prisma.orderEmailAlias.update({
        where: { id: alias.id },
        data: { lastInboundAt: new Date() },
      })
      return { status: 'no_valid_attachment' as const, inboundEmail }
    }

    const mimeType = attachment.ContentType.toLowerCase()
    const fileName = attachment.Name ?? `invoice-${alias.orderId}.pdf`
    const body = new Uint8Array(Buffer.from(attachment.Content, 'base64'))
    const sizeBytes = attachment.ContentLength ?? body.byteLength
    validateInvoiceFile(mimeType, sizeBytes)

    const previous = await prisma.orderSellerInvoice.findUnique({
      where: {
        orderId_sellerId: {
          orderId: alias.orderId,
          sellerId: alias.sellerId,
        },
      },
      select: { fileKey: true },
    })

    const uploaded = await uploadObject({
      folder: 'documents',
      mimeType,
      ownerId: alias.sellerId,
      body,
    })

    try {
      const { inboundEmail, invoice } = await prisma.$transaction(async (tx) => {
        const inboundEmail = await tx.inboundEmail.create({
          data: {
            messageId,
            orderId: alias.orderId,
            sellerId: alias.sellerId,
            aliasEmail: alias.aliasEmail,
            fromEmail: payload.FromFull?.Email ?? payload.From ?? null,
            subject: payload.Subject ?? null,
            status: 'processed',
            selectedAttachment: {
              fileName,
              mimeType,
              sizeBytes,
            },
          },
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
            fileUrl: uploaded.publicUrl,
            fileKey: uploaded.key,
            fileName,
            mimeType,
            sizeBytes,
            source: 'inbound_email',
            uploadedAt: new Date(),
          },
          update: {
            inboundEmailId: inboundEmail.id,
            fileUrl: uploaded.publicUrl,
            fileKey: uploaded.key,
            fileName,
            mimeType,
            sizeBytes,
            source: 'inbound_email',
            uploadedAt: new Date(),
          },
          select: invoiceSummarySelect,
        })

        await tx.orderEmailAlias.update({
          where: { id: alias.id },
          data: { lastInboundAt: new Date() },
        })

        return { inboundEmail, invoice }
      })

      if (previous?.fileKey && previous.fileKey !== uploaded.key) {
        await deleteObject(previous.fileKey).catch(() => null)
      }

      const customer = await prisma.order.findUnique({
        where: { id: alias.orderId },
        select: { customerId: true, customer: { select: { email: true, name: true } } },
      })

      if (customer) {
        await enqueueNotification({
          userId: customer.customerId,
          type: 'invoice_uploaded',
          title: 'Faturanız hazır',
          body: 'Siparişiniz için satıcı faturası yüklendi.',
          data: {
            orderId: alias.orderId,
            sellerId: alias.sellerId,
            customerName: customer.customer.name ?? '',
            orderNumber: alias.orderId.slice(-8).toUpperCase(),
            orderUrl: buildOrderUrl(alias.orderId),
          },
          emailTo: customer.customer.email,
        }).catch((error) => {
          console.error('[invoice-alias] customer notification failed:', error)
        })
      }

      return { status: 'processed' as const, inboundEmail, invoice }
    } catch (error) {
      await deleteObject(uploaded.key).catch(() => null)
      throw error
    }
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
    uploadInvoiceForSeller,
    ingestPostmarkInboundEmail,
  }
}

export type OrderDocumentService = ReturnType<typeof createOrderDocumentService>
