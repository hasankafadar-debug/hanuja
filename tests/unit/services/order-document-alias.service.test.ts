import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteObjectMock, readObjectMock, recordNotificationMock } = vi.hoisted(() => ({
  deleteObjectMock: vi.fn(),
  readObjectMock: vi.fn(),
  recordNotificationMock: vi.fn(),
}))

const emailOrderSnapshot = {
  id: 'order-1',
  publicNumber: 26050042,
  customerId: 'customer-1',
  customer: { email: 'customer@example.com', name: 'Ayşe Yılmaz' },
  address: { fullName: 'Ayşe Yılmaz' },
  lines: [
    {
      productName: 'Gea Berjer',
      variantName: null,
      sellerId: 'seller-1',
      unitPrice: { toString: () => '10.00' },
      totalPrice: { div: () => ({ mul: () => '20.00' }) },
      quantity: 2,
      cancelledQuantity: 0,
      product: { images: [] },
    },
  ],
}

vi.mock('../../../api/lib/r2', () => ({
  DOCUMENT_ALLOWED_MIME_TYPES: new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024,
  deleteObject: deleteObjectMock,
  readObject: readObjectMock,
}))

vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: recordNotificationMock,
}))

vi.mock('../../../api/services/private-document-cleanup.service', () => ({
  schedulePrivateDocumentCleanup: vi.fn().mockResolvedValue(undefined),
  processPrivateDocumentCleanup: vi.fn(async ({ fileKey, deleteFile }) => deleteFile(fileKey)),
}))

function addMutationMocks(prisma: any) {
  prisma.$executeRaw = vi.fn().mockResolvedValue(1)
  prisma.orderSellerInvoicePolicy = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(async ({ create }) => ({ id: 'policy-1', ...create })),
  }
  prisma.adminAuditLog = { create: vi.fn().mockResolvedValue({}) }
  prisma.orderSellerInvoice.findUnique ??= vi.fn().mockResolvedValue(null)
  prisma.orderSellerInvoice.upsert.mockImplementation(async ({ create }) => ({ id: 'invoice-1', createdAt: new Date(), ...create }))
}

import { createOrderDocumentService } from '../../../api/services/order-document.service'

describe('order-document.service invoice aliasing', () => {
  beforeEach(() => {
    vi.stubEnv('INVOICE_ALIASING_ENABLED', 'true')
    vi.stubEnv('INBOUND_EMAIL_DOMAIN', 'fatura.hanuja.tr')
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
    deleteObjectMock.mockReset()
    deleteObjectMock.mockResolvedValue(undefined)
    readObjectMock.mockReset()
    recordNotificationMock.mockReset()
    recordNotificationMock.mockResolvedValue(undefined)
  })

  it('creates one stable invoice alias for an order and seller', async () => {
    const prisma = {
      order: {
        findFirst: vi.fn().mockResolvedValue({ id: 'order-1' }),
      },
      orderEmailAlias: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'alias-1', ...data })),
      },
    } as never

    const service = createOrderDocumentService({ prisma })
    const alias = await service.ensureInvoiceAliasForSeller('order-1', 'seller-1')

    expect(alias?.aliasEmail).toMatch(/^pf[a-f0-9]{10}@fatura\.hanuja\.tr$/)
    expect(prisma.orderEmailAlias.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        sellerId: 'seller-1',
        purpose: 'invoice',
      }),
    })
  })

  it('returns the existing alias without regenerating it', async () => {
    const existing = { id: 'alias-1', aliasEmail: 'pfexisting@fatura.hanuja.tr' }
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1' }) },
      orderEmailAlias: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
    } as never
    expect(await createOrderDocumentService({ prisma }).ensureInvoiceAliasForSeller('order-1', 'seller-1')).toBe(existing)
    expect(prisma.orderEmailAlias.create).not.toHaveBeenCalled()
  })

  it('reuses the winner after a concurrent order/seller unique conflict', async () => {
    const winner = { id: 'alias-1', aliasEmail: 'pfwinner@fatura.hanuja.tr' }
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1' }) },
      orderEmailAlias: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner),
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      },
    } as never
    expect(await createOrderDocumentService({ prisma }).ensureInvoiceAliasForSeller('order-1', 'seller-1')).toBe(winner)
    expect(prisma.orderEmailAlias.create).toHaveBeenCalledTimes(1)
  })

  it('does not create aliases when disabled or when the order is not seller-visible', async () => {
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      orderEmailAlias: { findUnique: vi.fn(), create: vi.fn() },
    } as never
    vi.stubEnv('INVOICE_ALIASING_ENABLED', 'false')
    expect(await createOrderDocumentService({ prisma }).ensureInvoiceAliasForSeller('order-1', 'seller-1')).toBeNull()
    expect(prisma.order.findFirst).not.toHaveBeenCalled()
    vi.stubEnv('INVOICE_ALIASING_ENABLED', 'true')
    await expect(createOrderDocumentService({ prisma }).ensureInvoiceAliasForSeller('order-1', 'seller-2')).rejects.toThrow()
    expect(prisma.orderEmailAlias.create).not.toHaveBeenCalled()
    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.any(Array), lines: { some: { sellerId: 'seller-2' } } }) }))
  })

  it('keeps a pending invoice when an unrelated sender knows its Postmark alias', async () => {
    const storage = { write: vi.fn().mockResolvedValue({ key: 'private/v1/aa/new.bin' }), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }

    const prisma: any = {
      inboundEmail: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'inbound-1',
          messageId: 'pm-1',
          status: 'processed',
        }),
      },
      orderEmailAlias: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'alias-1',
          orderId: 'order-1',
          sellerId: 'seller-1',
          aliasEmail: 'pfabc@fatura.hanuja.tr',
        }]),
        update: vi.fn().mockResolvedValue({}),
      },
      orderSellerInvoice: {
        findUnique: vi.fn().mockResolvedValue({ id: 'old-invoice', sellerId: 'seller-1', fileKey: 'documents/seller-1/old.pdf', createdAt: new Date(), fileName: 'old.pdf', mimeType: 'application/pdf', sizeBytes: 10, source: 'manual' }),
        upsert: vi.fn().mockResolvedValue({
          id: 'invoice-1',
          orderId: 'order-1',
          sellerId: 'seller-1',
          fileName: 'invoice.pdf',
        }),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue(emailOrderSnapshot),
      },
      seller: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Atelier Noa' }) },
      $transaction: vi.fn((callback) => callback(prisma)),
    }

    addMutationMocks(prisma)
    const service = createOrderDocumentService({ prisma, storage })
    const result = await service.ingestPostmarkInboundEmail({
      MessageID: 'pm-1',
      From: 'unrelated@example.net',
      ToFull: [{ Email: 'pfabc@fatura.hanuja.tr' }],
      Subject: 'Fatura',
      Attachments: [
        {
          Name: 'invoice.xml',
          ContentType: 'application/xml',
          Content: Buffer.from('<xml />').toString('base64'),
        },
        {
          Name: 'invoice.pdf',
          ContentType: 'application/pdf',
          Content: Buffer.from('%PDF-1.7\ntest').toString('base64'),
          ContentLength: 3,
        },
      ],
    })

    expect(result.status).toBe('blocked_invoice_policy')
    expect(storage.write).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(deleteObjectMock).not.toHaveBeenCalledWith('documents/seller-1/old.pdf')
    // Satıcı Hanuja modeli: a new file needs a fresh admin review and is never sent to the customer.
    expect(prisma.orderSellerInvoice.upsert).not.toHaveBeenCalled()
    expect(prisma.inboundEmail.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'blocked_invoice_policy', errorReason: 'Existing seller invoice cannot be replaced by e-mail',
    }) })
    expect(recordNotificationMock).not.toHaveBeenCalled()
  })

  it('blocks an e-mailed file from replacing an approved seller invoice', async () => {
    const storage = { write: vi.fn().mockResolvedValue({ key: 'private/v1/aa/late.bin' }), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }
    const prisma: any = {
      inboundEmail: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({ id: 'inbound-2', ...data })),
      },
      orderEmailAlias: {
        findMany: vi.fn().mockResolvedValue([{ id: 'alias-1', orderId: 'order-1', sellerId: 'seller-1', aliasEmail: 'pfabc@fatura.hanuja.tr' }]),
        update: vi.fn().mockResolvedValue({}),
      },
      orderSellerInvoice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'approved-invoice', sellerId: 'seller-1', fileKey: 'private/v1/aa/approved.bin', createdAt: new Date(),
          fileName: 'approved.pdf', mimeType: 'application/pdf', sizeBytes: 10, source: 'manual', reviewStatus: 'approved',
        }),
        upsert: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    }
    addMutationMocks(prisma)
    const service = createOrderDocumentService({ prisma, storage })
    const result = await service.ingestPostmarkInboundEmail({
      MessageID: 'pm-2',
      ToFull: [{ Email: 'pfabc@fatura.hanuja.tr' }],
      Attachments: [{ Name: 'late.pdf', ContentType: 'application/pdf', Content: Buffer.from('%PDF-1.7\nlate').toString('base64') }],
    })
    expect(result.status).toBe('blocked_invoice_policy')
    expect(prisma.inboundEmail.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ errorReason: 'Approved seller invoice cannot be replaced by e-mail' }),
    }))
    expect(prisma.orderSellerInvoice.upsert).not.toHaveBeenCalled()
  })

  it('keeps a manually uploaded seller invoice internal: fresh review, audit, no customer notification', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.hanuja.com.tr')
    const storage = { write: vi.fn().mockResolvedValue({ key: 'private/v1/aa/manual.bin' }), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }

    const prisma: any = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'order-1',
          customerId: 'customer-1',
          customer: { email: 'customer@example.com', name: 'Ayşe Yılmaz' },
          sellerInvoices: [],
        }),
        findUnique: vi.fn().mockResolvedValue(emailOrderSnapshot),
      },
      seller: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Atelier Noa', userId: 'seller-user', status: 'active' }) },
      orderSellerInvoice: {
        upsert: vi.fn().mockResolvedValue({
          id: 'invoice-1',
          orderId: 'order-1',
          sellerId: 'seller-1',
          fileName: 'fatura.pdf',
        }),
      },
      $transaction: vi.fn((callback: (client: unknown) => unknown) => callback(prisma)),
    }

    addMutationMocks(prisma)
    const service = createOrderDocumentService({ prisma, storage })
    await service.uploadInvoiceForSeller({
      actorId: 'seller-user',
      orderId: 'order-1',
      sellerId: 'seller-1',
      fileName: 'fatura.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      body: new Uint8Array([1, 2, 3]),
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.orderSellerInvoice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ reviewStatus: 'pending', reviewedAt: null, invoiceNumber: null }),
    }))
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'order_invoice_uploaded', targetId: 'order-1' }),
    }))
    expect(recordNotificationMock).not.toHaveBeenCalled()
  })

  it('refuses a seller replacement once the invoice is approved', async () => {
    const storage = { write: vi.fn().mockResolvedValue({ key: 'private/v1/aa/replace.bin' }), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }
    const prisma: any = {
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1' }) },
      seller: { findUnique: vi.fn().mockResolvedValue({ userId: 'seller-user', status: 'active' }) },
      orderSellerInvoice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invoice-1', sellerId: 'seller-1', fileKey: 'private/v1/aa/approved.bin', createdAt: new Date(),
          fileName: 'fatura.pdf', mimeType: 'application/pdf', sizeBytes: 3, source: 'manual', reviewStatus: 'approved',
        }),
        upsert: vi.fn(),
      },
      $transaction: vi.fn((callback: (client: unknown) => unknown) => callback(prisma)),
    }
    addMutationMocks(prisma)
    const service = createOrderDocumentService({ prisma, storage })
    await expect(service.uploadInvoiceForSeller({
      actorId: 'seller-user', orderId: 'order-1', sellerId: 'seller-1',
      fileName: 'yeni.pdf', mimeType: 'application/pdf', sizeBytes: 3, body: new Uint8Array([1, 2, 3]),
      expectedRevision: 'ignored', reason: 'Yanlış tutar düzeltmesi',
    })).rejects.toThrow('Onaylanan fatura değiştirilemez')
    expect(prisma.orderSellerInvoice.upsert).not.toHaveBeenCalled()
  })

  it('rolls the upload back and removes the stored file when the audit record cannot be written', async () => {
    const storage = { write: vi.fn().mockResolvedValue({ key: 'private/v1/aa/manual.bin' }), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }

    const prisma: any = {
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'order-1',
          customerId: 'customer-1',
          customer: { email: 'customer@example.com', name: 'Ayşe Yılmaz' },
          sellerInvoices: [],
        }),
        findUnique: vi.fn().mockResolvedValue(emailOrderSnapshot),
      },
      seller: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Atelier Noa', userId: 'seller-user', status: 'active' }) },
      orderSellerInvoice: {
        upsert: vi.fn().mockResolvedValue({ id: 'invoice-1', orderId: 'order-1', sellerId: 'seller-1' }),
      },
      $transaction: vi.fn((callback: (client: unknown) => unknown) => callback(prisma)),
    }

    addMutationMocks(prisma)
    prisma.adminAuditLog.create.mockRejectedValueOnce(new Error('db down'))
    const service = createOrderDocumentService({ prisma, storage })
    await expect(
      service.uploadInvoiceForSeller({
        actorId: 'seller-user',
        orderId: 'order-1',
        sellerId: 'seller-1',
        fileName: 'fatura.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        body: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow('db down')

    // Fixture key is not a private-storage key, so cleanup goes through R2 deleteObject.
    expect(deleteObjectMock).toHaveBeenCalledWith('private/v1/aa/manual.bin')
  })

  it('logs no_valid_attachment without changing invoice', async () => {
    const storage = { write: vi.fn(), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }
    const prisma = {
      inboundEmail: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'inbound-1', status: 'no_valid_attachment' }),
      },
      orderEmailAlias: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'alias-1',
          orderId: 'order-1',
          sellerId: 'seller-1',
          aliasEmail: 'pfabc@fatura.hanuja.tr',
        }]),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never

    const service = createOrderDocumentService({ prisma, storage })
    const result = await service.ingestPostmarkInboundEmail({
      MessageID: 'pm-2',
      ToFull: [{ Email: 'pfabc@fatura.hanuja.tr' }],
      Attachments: [{ Name: 'invoice.xml', ContentType: 'application/xml', Content: 'PHhtbCAvPg==' }],
    })

    expect(result.status).toBe('no_valid_attachment')
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('logs unknown aliases and does not upload attachments', async () => {
    const storage = { write: vi.fn(), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }
    const prisma = {
      inboundEmail: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'inbound-unknown', status: 'unknown_alias' }),
      },
      orderEmailAlias: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as never

    const service = createOrderDocumentService({ prisma, storage })
    const result = await service.ingestPostmarkInboundEmail({
      MessageID: 'pm-unknown',
      ToFull: [{ Email: 'missing@fatura.hanuja.tr' }],
      Attachments: [
        {
          Name: 'invoice.pdf',
          ContentType: 'application/pdf',
          Content: Buffer.from('pdf').toString('base64'),
        },
      ],
    })

    expect(result.status).toBe('unknown_alias')
    expect(storage.write).not.toHaveBeenCalled()
  })
})
