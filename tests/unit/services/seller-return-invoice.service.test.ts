/**
 * Hanuja's return invoice to the designer: the invoice date is a Türkiye calendar day.
 * Today's date is valid at any hour of the Istanbul day (it used to be refused before
 * 12:00); tomorrow and impossible dates are refused before the invoice or its file changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../api/lib/r2', () => ({ DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024 }))
vi.mock('../../../api/services/notification-outbox.service', () => ({ recordNotification: vi.fn() }))
vi.mock('../../../api/services/private-document-cleanup.service', () => ({
  schedulePrivateDocumentCleanup: vi.fn(),
  processPrivateDocumentCleanup: vi.fn(),
}))

import { createSellerReturnInvoiceService } from '../../../api/services/seller-return-invoice.service'

const identity = { returnRequestId: 'return-1', sellerId: 'seller-1', actorId: 'admin-1' }
const storedInvoice = {
  id: 'return-invoice-1',
  returnRequestId: 'return-1',
  sellerId: 'seller-1',
  orderId: 'order-1',
  refundIds: ['refund-1'],
  invoiceNumber: 'HNJ2026000000045',
  invoiceDate: new Date('2026-10-16T09:00:00.000Z'),
  amount: '912.00',
  vatGroups: [],
  fileKey: 'private/v1/bb/return-invoice.bin',
  fileName: 'iade-faturasi.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1200,
  uploadedByAdminId: 'admin-1',
  uploadedAt: new Date('2026-10-16T10:00:00.000Z'),
}

function fixture() {
  const prisma: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'admin' }) },
    returnRequest: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'return-1',
        orderId: 'order-1',
        status: 'refund_completed',
        reviewedAt: new Date('2026-10-15T10:00:00.000Z'),
        disputeId: null,
        order: { publicNumber: 26050042, lines: [] },
      }),
    },
    refundTransaction: { findMany: vi.fn().mockResolvedValue([]) },
    orderSellerInvoice: { findUnique: vi.fn().mockResolvedValue({ reviewStatus: 'approved' }) },
    sellerReturnInvoice: {
      findUnique: vi.fn().mockResolvedValue(storedInvoice),
      update: vi.fn(async ({ data }) => ({ ...storedInvoice, ...data })),
    },
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  }
  prisma.$transaction = vi.fn((callback: (tx: unknown) => unknown) => callback(prisma))
  const storage = {
    write: vi.fn().mockResolvedValue({ key: 'private/v1/cc/new.bin', encryptedSizeBytes: 64 }),
    read: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn(),
  }
  return { prisma, storage, service: createSellerReturnInvoiceService({ prisma, storage }) }
}

type Service = ReturnType<typeof fixture>['service']

async function editDate(service: Service, invoiceDate: string) {
  const { revision } = (await service.getForSeller(identity))!
  return service.update({
    ...identity,
    expectedRevision: revision,
    reason: 'Fatura tarihi düzeltildi',
    invoiceNumber: 'HNJ2026000000046',
    invoiceDate,
  })
}

describe('Hanuja return invoice date', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 17 Ekim 2026 08:00 Europe/Istanbul.
    vi.setSystemTime(new Date('2026-10-17T05:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['00:30', '2026-10-16T21:30:00.000Z'],
    ['08:00', '2026-10-17T05:00:00.000Z'],
    ['23:59', '2026-10-17T20:59:00.000Z'],
  ])('at %s Istanbul time accepts today and refuses tomorrow', async (_time, now) => {
    vi.setSystemTime(new Date(now))
    const { prisma, service } = fixture()

    await expect(editDate(service, '2026-10-18')).rejects.toThrow(
      'Fatura tarihi geçerli olmalı ve ileri tarih olmamalıdır.',
    )
    expect(prisma.sellerReturnInvoice.update).not.toHaveBeenCalled()

    const saved = await editDate(service, '2026-10-17')
    expect(prisma.sellerReturnInvoice.update).toHaveBeenCalledWith({
      where: { returnRequestId_sellerId: { returnRequestId: 'return-1', sellerId: 'seller-1' } },
      // Same calendar day in UTC and Istanbul; the admin card shows the ISO date part.
      data: { invoiceNumber: 'HNJ2026000000046', invoiceDate: new Date('2026-10-17T09:00:00.000Z') },
    })
    expect(saved!.invoiceDate.toISOString().slice(0, 10)).toBe('2026-10-17')
    expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an impossible day', '2026-02-30', 'geçerli olmalı'],
    ['an impossible month', '2026-13-01', 'geçerli olmalı'],
    ['a date with a time', '2026-10-17T05:00', 'YYYY-MM-DD'],
    ['a local date format', '17.10.2026', 'YYYY-MM-DD'],
  ])('refuses %s without changing the invoice', async (_label, invoiceDate, message) => {
    const { prisma, service } = fixture()
    await expect(editDate(service, invoiceDate)).rejects.toThrow(message)
    expect(prisma.sellerReturnInvoice.update).not.toHaveBeenCalled()
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled()
  })

  it('refuses a future date on upload before the PDF is stored', async () => {
    const { prisma, storage, service } = fixture()
    await expect(
      service.upload({
        ...identity,
        invoiceNumber: 'HNJ2026000000046',
        invoiceDate: '2026-10-18',
        fileName: 'iade-faturasi.pdf',
        mimeType: 'application/pdf',
        body: Buffer.from('%PDF-1.4\nRETURN INVOICE\n%%EOF'),
      }),
    ).rejects.toThrow('ileri tarih')
    expect(storage.write).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
