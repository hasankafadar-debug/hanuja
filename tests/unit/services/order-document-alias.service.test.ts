import { beforeEach, describe, expect, it, vi } from 'vitest'

const { uploadObjectMock, deleteObjectMock, enqueueNotificationMock } = vi.hoisted(() => ({
  uploadObjectMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  enqueueNotificationMock: vi.fn(),
}))

vi.mock('../../../api/lib/r2', () => ({
  DOCUMENT_ALLOWED_MIME_TYPES: new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024,
  uploadObject: uploadObjectMock,
  deleteObject: deleteObjectMock,
}))

vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: enqueueNotificationMock,
}))

import { createOrderDocumentService } from '../../../api/services/order-document.service'

describe('order-document.service invoice aliasing', () => {
  beforeEach(() => {
    vi.stubEnv('INVOICE_ALIASING_ENABLED', 'true')
    vi.stubEnv('INBOUND_EMAIL_DOMAIN', 'fatura.hanuja.tr')
    uploadObjectMock.mockReset()
    deleteObjectMock.mockReset()
    deleteObjectMock.mockResolvedValue(undefined)
    enqueueNotificationMock.mockReset()
    enqueueNotificationMock.mockResolvedValue(undefined)
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
    uploadObjectMock.mockResolvedValue({
      key: 'documents/seller-1/new.pdf',
      publicUrl: 'https://cdn.example/documents/seller-1/new.pdf',
    })

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
        findUnique: vi.fn().mockResolvedValue({
          customerId: 'customer-1',
          customer: { email: 'customer@example.com', name: 'Ayşe Yılmaz' },
        }),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    }

    const service = createOrderDocumentService({ prisma })
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
    expect(uploadObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'documents',
        mimeType: 'application/pdf',
        ownerId: 'seller-1',
      }),
    )
    expect(prisma.orderSellerInvoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: 'inbound_email',
          inboundEmailId: 'inbound-1',
        }),
      }),
    )
    expect(deleteObjectMock).toHaveBeenCalledWith('documents/seller-1/old.pdf')
    expect(enqueueNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'customer-1',
        type: 'invoice_uploaded',
        emailTo: 'customer@example.com',
      }),
    )
  })

  it('logs no_valid_attachment without changing invoice', async () => {
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

    const service = createOrderDocumentService({ prisma })
    const result = await service.ingestPostmarkInboundEmail({
      MessageID: 'pm-2',
      ToFull: [{ Email: 'pfabc@fatura.hanuja.tr' }],
      Attachments: [{ Name: 'invoice.xml', ContentType: 'application/xml', Content: 'PHhtbCAvPg==' }],
    })

    expect(result.status).toBe('no_valid_attachment')
    expect(uploadObjectMock).not.toHaveBeenCalled()
  })

  it('logs unknown aliases and does not upload attachments', async () => {
    const prisma = {
      inboundEmail: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'inbound-unknown', status: 'unknown_alias' }),
      },
      orderEmailAlias: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as never

    const service = createOrderDocumentService({ prisma })
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
    expect(uploadObjectMock).not.toHaveBeenCalled()
  })
})
