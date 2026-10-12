/**
 * Hanuja's sales invoice to the customer (satıcı Hanuja modeli): uploaded by an admin for a
 * paid order, versioned with If-Match, audited, and announced once per file revision.
 * The customer reads only the invoice of their own order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { recordNotificationMock, scheduleCleanupMock, processCleanupMock } = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
  scheduleCleanupMock: vi.fn(),
  processCleanupMock: vi.fn(),
}))

vi.mock('../../../api/lib/r2', () => ({
  DOCUMENT_ALLOWED_MIME_TYPES: new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024,
}))
vi.mock('../../../api/services/notification-outbox.service', () => ({ recordNotification: recordNotificationMock }))
vi.mock('../../../api/services/private-document-cleanup.service', () => ({
  schedulePrivateDocumentCleanup: scheduleCleanupMock,
  processPrivateDocumentCleanup: processCleanupMock,
}))

import { createCustomerInvoiceService } from '../../../api/services/customer-invoice.service'
import { getInvoiceRevision } from '../../../api/lib/invoice-management'

const existing = {
  id: 'customer-invoice-1', orderId: 'order-1', fileKey: 'private/v1/aa/old.bin', fileName: 'eski.pdf',
  mimeType: 'application/pdf', sizeBytes: 10, invoiceNumber: 'HNJ2026000000001',
  uploadedAt: new Date('2026-10-08T10:00:00Z'),
}

function fixture(options: { role?: string; paid?: boolean; current?: typeof existing | null } = {}) {
  const storage = {
    write: vi.fn().mockResolvedValue({ key: 'private/v1/bb/new.bin' }),
    read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    exists: vi.fn(),
    delete: vi.fn(),
  }
  const prisma: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ role: options.role ?? 'admin' }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    orderCustomerInvoice: {
      findUnique: vi.fn().mockResolvedValue(options.current === undefined ? null : options.current),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(async ({ create }) => ({ id: options.current?.id ?? 'customer-invoice-1', ...create })),
      delete: vi.fn().mockResolvedValue({}),
    },
    order: {
      findFirst: vi.fn().mockResolvedValue(options.paid === false ? null : { id: 'order-1' }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'order-1',
        publicNumber: 26050042,
        customerId: 'customer-1',
        customer: { email: 'customer@example.test', name: 'Ayşe Yılmaz' },
        address: { fullName: 'Ayşe Yılmaz' },
        lines: [
          { productName: 'Gea Berjer', variantName: null, unitPrice: new Decimal(500), totalPrice: new Decimal(1000),
            quantity: 2, cancelledQuantity: 1, product: { images: [] } },
          { productName: 'İptal Edilen Vazo', variantName: null, unitPrice: new Decimal(100), totalPrice: new Decimal(100),
            quantity: 1, cancelledQuantity: 1, product: { images: [] } },
        ],
      }),
    },
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  prisma.$transaction = vi.fn((callback: (tx: unknown) => unknown) => callback(prisma))
  return { prisma, storage, service: createCustomerInvoiceService({ prisma, storage }) }
}

const upload = (extra: Record<string, unknown> = {}) => ({
  orderId: 'order-1', actorId: 'admin-1', fileName: 'fatura.pdf', mimeType: 'application/pdf',
  body: new Uint8Array([37, 80, 68, 70]), invoiceNumber: 'HNJ2026000000123', ...extra,
})

describe('customer-invoice.service', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
    recordNotificationMock.mockReset().mockResolvedValue(undefined)
    scheduleCleanupMock.mockReset().mockResolvedValue(undefined)
    processCleanupMock.mockReset().mockResolvedValue(undefined)
  })

  it('lets only an admin upload and stores nothing otherwise', async () => {
    const { storage, service } = fixture({ role: 'seller' })
    await expect(service.uploadForAdmin(upload())).rejects.toThrow('Admin yetkisi gerekli')
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('refuses an order whose payment is not confirmed', async () => {
    const { storage, service } = fixture({ paid: false })
    await expect(service.uploadForAdmin(upload())).rejects.toThrow('Ödemesi onaylanmamış')
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('refuses unsupported files and unsafe invoice numbers before any lookup', async () => {
    const { prisma, service } = fixture()
    await expect(service.uploadForAdmin(upload({ mimeType: 'text/html' }))).rejects.toThrow('PDF, JPEG, PNG veya WEBP')
    await expect(service.uploadForAdmin(upload({ invoiceNumber: '<b>1</b>' }))).rejects.toThrow('Fatura numarası')
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("uploads the first invoice, audits it and announces Hanuja's invoice to the order's customer", async () => {
    const { prisma, service } = fixture()
    const result = await service.uploadForAdmin(upload())
    const revision = getInvoiceRevision({ id: 'customer-invoice-1', fileKey: 'private/v1/bb/new.bin' })
    expect(result).toMatchObject({ orderId: 'order-1', invoiceNumber: 'HNJ2026000000123', revision })
    expect(prisma.orderCustomerInvoice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: 'order-1' },
      create: expect.objectContaining({
        fileUrl: 'private://customer-invoice', fileKey: 'private/v1/bb/new.bin', uploadedByAdminId: 'admin-1',
      }),
    }))
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: 'admin-1', actionType: 'customer_invoice_uploaded', targetId: 'order-1',
    }) })
    expect(recordNotificationMock).toHaveBeenCalledTimes(1)
    const [, notification] = recordNotificationMock.mock.calls[0]!
    expect(notification).toMatchObject({
      eventKey: `customer-invoice:order-1:${revision}`,
      userId: 'customer-1',
      type: 'invoice_uploaded',
      emailTo: 'customer@example.test',
      data: {
        orderId: 'order-1',
        orderNumber: '26050042',
        orderUrl: 'https://www.hanuja.com.tr/siparis/order-1',
        invoiceUrl: 'https://www.hanuja.com.tr/api/orders/order-1/documents/customer-invoice',
      },
    })
    // Only the units that were not cancelled appear in the e-mail.
    expect(notification.data.items).toHaveLength(1)
    expect(notification.data.items[0]).toMatchObject({ productName: 'Gea Berjer', quantity: 1 })
    expect(notification.data).not.toHaveProperty('sellerName')
  })

  it('replaces only with the current revision and a reason, and retires the old file', async () => {
    const { prisma, service } = fixture({ current: existing })
    const oldRevision = getInvoiceRevision(existing)
    await expect(service.uploadForAdmin(upload({ expectedRevision: `"${oldRevision}"` }))).rejects.toThrow('Gerekçe')
    expect(scheduleCleanupMock).toHaveBeenCalledWith(prisma, 'private/v1/bb/new.bin')

    scheduleCleanupMock.mockClear()
    await service.uploadForAdmin(upload({ expectedRevision: `"${oldRevision}"`, reason: 'Fatura numarası düzeltildi' }))
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actionType: 'customer_invoice_replaced', reason: 'Fatura numarası düzeltildi',
    }) })
    expect(scheduleCleanupMock).toHaveBeenCalledWith(prisma, 'private/v1/aa/old.bin')
    const newRevision = getInvoiceRevision({ id: existing.id, fileKey: 'private/v1/bb/new.bin' })
    expect(recordNotificationMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
      eventKey: `customer-invoice:order-1:${newRevision}`,
    }))
  })

  it('keeps the stored invoice when the admin decided on an older revision', async () => {
    const { prisma, service } = fixture({ current: existing })
    await expect(service.uploadForAdmin(upload({ expectedRevision: 'c'.repeat(64), reason: 'Düzeltme yapıldı' })))
      .rejects.toThrow('Fatura değişti')
    expect(prisma.orderCustomerInvoice.upsert).not.toHaveBeenCalled()
    expect(recordNotificationMock).not.toHaveBeenCalled()
    // The staged upload is scheduled for cleanup; the stored file stays referenced.
    expect(scheduleCleanupMock).toHaveBeenCalledWith(prisma, 'private/v1/bb/new.bin')
    expect(scheduleCleanupMock).not.toHaveBeenCalledWith(expect.anything(), 'private/v1/aa/old.bin')
  })

  it('removes with a reason and an audit record', async () => {
    const { prisma, service } = fixture({ current: existing })
    await expect(service.removeForAdmin({ orderId: 'order-1', actorId: 'admin-1', expectedRevision: getInvoiceRevision(existing), reason: 'Yanlış siparişe yüklendi' }))
      .resolves.toEqual({ removed: true })
    expect(prisma.orderCustomerInvoice.delete).toHaveBeenCalledWith({ where: { id: existing.id } })
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'customer_invoice_removed' }) })
    expect(scheduleCleanupMock).toHaveBeenCalledWith(prisma, existing.fileKey)
  })

  it("serves a customer only their own order's invoice", async () => {
    const { prisma, service } = fixture()
    prisma.orderCustomerInvoice.findFirst.mockResolvedValueOnce(null)
    await expect(service.getForCustomer('order-1', 'other-customer')).rejects.toThrow()
    expect(prisma.orderCustomerInvoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: 'order-1', order: { customerId: 'other-customer' } },
    }))
    await service.listForCustomer('customer-1')
    expect(prisma.orderCustomerInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order: { customerId: 'customer-1' } },
    }))
  })
})
