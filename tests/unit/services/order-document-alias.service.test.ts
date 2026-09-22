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

import { createOrderDocumentService } from '../../../api/services/order-document.service'

describe('order-document.service invoice aliasing', () => {
  beforeEach(() => {
    vi.stubEnv('INVOICE_ALIASING_ENABLED', 'true')
    vi.stubEnv('INBOUND_EMAIL_DOMAIN', 'fatura.hanuja.tr')
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

  it('processes a known Postmark alias with a PDF attachment', async () => {
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
        findFirst: vi.fn().mockResolvedValue({
          id: 'alias-1',
          orderId: 'order-1',
          sellerId: 'seller-1',
          aliasEmail: 'pfabc@fatura.hanuja.tr',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      orderSellerInvoice: {
        findUnique: vi.fn().mockResolvedValue({ fileKey: 'documents/seller-1/old.pdf' }),
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

    const service = createOrderDocumentService({ prisma, storage })
    const result = await service.ingestPostmarkInboundEmail({
      MessageID: 'pm-1',
      From: 'efatura@example.com',
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
          Content: Buffer.from('pdf').toString('base64'),
          ContentLength: 3,
        },
      ],
    })

    expect(result.status).toBe('processed')
    expect(storage.write).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(prisma.orderSellerInvoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: 'inbound_email',
          inboundEmailId: 'inbound-1',
          fileKey: 'private/v1/aa/new.bin',
          fileUrl: 'private://seller-invoice',
        }),
      }),
    )
    expect(deleteObjectMock).toHaveBeenCalledWith('documents/seller-1/old.pdf')
    expect(recordNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'customer-1',
        type: 'invoice_uploaded',
        emailTo: 'customer@example.com',
        data: expect.objectContaining({ orderNumber: '26050042', sellerName: 'Atelier Noa' }),
      }),
    )
  })

  it('records an invoice_uploaded notification with order, invoice links and seller lines in the upload transaction', async () => {
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
      seller: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Atelier Noa' }) },
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

    const service = createOrderDocumentService({ prisma, storage })
    await service.uploadInvoiceForSeller({
      orderId: 'order-1',
      sellerId: 'seller-1',
      fileName: 'fatura.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      body: new Uint8Array([1, 2, 3]),
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(recordNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'customer-1',
        type: 'invoice_uploaded',
        emailTo: 'customer@example.com',
        eventKey: expect.stringMatching(/^invoice:order-1:seller-1:\d+$/),
        data: expect.objectContaining({
          orderId: 'order-1',
          sellerId: 'seller-1',
          sellerName: 'Atelier Noa',
          orderNumber: '26050042',
          orderUrl: 'https://www.hanuja.com.tr/siparis/order-1',
          invoiceUrl: 'https://www.hanuja.com.tr/api/orders/order-1/documents/invoices/seller-1',
          items: [expect.objectContaining({ productName: 'Gea Berjer', quantity: 2 })],
        }),
      }),
    )
  })

  it('rolls the upload back and removes the stored file when the notification cannot be recorded', async () => {
    const storage = { write: vi.fn().mockResolvedValue({ key: 'private/v1/aa/manual.bin' }), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }
    recordNotificationMock.mockRejectedValueOnce(new Error('db down'))

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
      seller: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Atelier Noa' }) },
      orderSellerInvoice: {
        upsert: vi.fn().mockResolvedValue({ id: 'invoice-1', orderId: 'order-1', sellerId: 'seller-1' }),
      },
      $transaction: vi.fn((callback: (client: unknown) => unknown) => callback(prisma)),
    }

    const service = createOrderDocumentService({ prisma, storage })
    await expect(
      service.uploadInvoiceForSeller({
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
        findFirst: vi.fn().mockResolvedValue({
          id: 'alias-1',
          orderId: 'order-1',
          sellerId: 'seller-1',
          aliasEmail: 'pfabc@fatura.hanuja.tr',
        }),
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
        findFirst: vi.fn().mockResolvedValue(null),
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
