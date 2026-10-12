/**
 * Admin review of the seller's invoice to Hanuja (satıcı Hanuja modeli).
 * Approval records invoice number and date and moves the payout term; rejection notifies
 * the seller. Only admins decide, and only on the file currently stored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { recordNotificationMock, syncInvoiceDueDateMock } = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
  syncInvoiceDueDateMock: vi.fn(),
}))

vi.mock('../../../api/lib/r2', () => ({
  DOCUMENT_ALLOWED_MIME_TYPES: new Set(['application/pdf']),
  DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024,
  deleteObject: vi.fn(),
  readObject: vi.fn(),
}))
vi.mock('../../../api/services/notification-outbox.service', () => ({ recordNotification: recordNotificationMock }))
vi.mock('../../../api/services/private-document-cleanup.service', () => ({
  schedulePrivateDocumentCleanup: vi.fn(),
  processPrivateDocumentCleanup: vi.fn(),
}))
vi.mock('../../../api/services/payout.service', () => ({
  createPayoutService: () => ({ syncInvoiceDueDate: syncInvoiceDueDateMock }),
}))

import { createOrderDocumentService } from '../../../api/services/order-document.service'
import { getInvoiceRevision } from '../../../api/lib/invoice-management'

const storedInvoice = {
  id: 'invoice-1',
  orderId: 'order-1',
  sellerId: 'seller-1',
  fileKey: 'private/v1/aa/invoice.bin',
  fileUrl: 'private://seller-invoice',
  fileName: 'fatura.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1200,
  source: 'manual',
  uploadedAt: new Date('2026-10-06T08:00:00Z'),
  createdAt: new Date('2026-10-06T08:00:00Z'),
  reviewStatus: 'pending',
  invoiceNumber: null,
  invoiceDate: null,
  reviewedAt: null,
  reviewNote: null,
}
const revision = getInvoiceRevision(storedInvoice)

function fixture(overrides: { role?: string; invoice?: Record<string, unknown> | null; paidAt?: Date } = {}) {
  const prisma: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ role: overrides.role ?? 'admin' }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    orderSellerInvoice: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.invoice === null ? null : { ...storedInvoice, ...overrides.invoice },
      ),
      update: vi.fn(async ({ data }) => ({ ...storedInvoice, ...overrides.invoice, ...data })),
    },
    orderSellerInvoicePolicy: {
      findUnique: vi.fn().mockResolvedValue({ firstUploadedAt: storedInvoice.createdAt }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'order-1',
        publicNumber: 26050042,
        paymentConfirmedAt: overrides.paidAt ?? new Date('2026-10-02T09:00:00Z'),
        payments: [],
      }),
    },
    seller: {
      findUnique: vi.fn().mockResolvedValue({
        userId: 'seller-user', displayName: 'Atelier Noa', user: { email: 'seller@example.test' },
      }),
    },
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  prisma.$transaction = vi.fn((callback: (tx: unknown) => unknown) => callback(prisma))
  return { prisma, service: createOrderDocumentService({ prisma }) }
}

const approve = (extra: Record<string, unknown> = {}) => ({
  orderId: 'order-1', sellerId: 'seller-1', actorId: 'admin-1', expectedRevision: `"${revision}"`,
  decision: 'approve' as const, invoiceNumber: 'GIB2026000000123', invoiceDate: '2026-10-05', ...extra,
})
const reject = (extra: Record<string, unknown> = {}) => ({
  orderId: 'order-1', sellerId: 'seller-1', actorId: 'admin-1', expectedRevision: revision,
  decision: 'reject' as const, note: 'KDV oranı ürünle uyuşmuyor; %20 ile yeniden kesin.', ...extra,
})

describe('reviewSellerInvoice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-11T09:00:00Z'))
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://satici.hanuja.com.tr')
    recordNotificationMock.mockReset().mockResolvedValue(undefined)
    syncInvoiceDueDateMock.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('lets only an admin decide', async () => {
    const { prisma, service } = fixture({ role: 'seller' })
    await expect(service.reviewSellerInvoice(approve({ actorId: 'seller-user' }))).rejects.toThrow('Admin yetkisi gerekli')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.orderSellerInvoice.update).not.toHaveBeenCalled()
  })

  it('approves with invoice number and Türkiye calendar date, audits it and moves the payout term', async () => {
    const { prisma, service } = fixture()
    const result = await service.reviewSellerInvoice(approve())
    expect(prisma.orderSellerInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice-1' },
      data: expect.objectContaining({
        reviewStatus: 'approved',
        reviewedByAdminId: 'admin-1',
        invoiceNumber: 'GIB2026000000123',
        // 5 Ekim 2026 00:00 Europe/Istanbul.
        invoiceDate: new Date('2026-10-04T21:00:00.000Z'),
        reviewNote: null,
      }),
    }))
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: 'admin-1', actionType: 'seller_invoice_approved', targetId: 'order-1',
      newData: expect.objectContaining({ reviewStatus: 'approved', invoiceDate: '2026-10-05', revision }),
    }) })
    expect(recordNotificationMock).not.toHaveBeenCalled()
    expect(syncInvoiceDueDateMock).toHaveBeenCalledWith({ orderId: 'order-1', sellerId: 'seller-1' })
    expect(result).not.toHaveProperty('fileKey')
    expect(result.revision).toBe(revision)
  })

  it.each([
    ['an unsafe invoice number', { invoiceNumber: '<script>' }, 'Fatura numarası'],
    ['a missing invoice number', { invoiceNumber: '  ' }, 'Fatura numarası'],
    ['an invalid date', { invoiceDate: '2026-13-01' }, 'Geçerli bir fatura tarihi'],
    ['a future date', { invoiceDate: '2026-10-12' }, 'ileri bir tarih'],
  ])('refuses %s before touching the invoice', async (_label, extra, message) => {
    const { prisma, service } = fixture()
    await expect(service.reviewSellerInvoice(approve(extra))).rejects.toThrow(message)
    expect(prisma.orderSellerInvoice.update).not.toHaveBeenCalled()
    expect(syncInvoiceDueDateMock).not.toHaveBeenCalled()
  })

  it('refuses an invoice dated before the order was paid', async () => {
    const { prisma, service } = fixture({ paidAt: new Date('2026-10-06T07:00:00Z') })
    await expect(service.reviewSellerInvoice(approve({ invoiceDate: '2026-10-05' }))).rejects.toThrow('ödeme tarihinden önce')
    expect(prisma.orderSellerInvoice.update).not.toHaveBeenCalled()
  })

  it('decides only on the file currently stored', async () => {
    const { prisma, service } = fixture()
    await expect(service.reviewSellerInvoice(approve({ expectedRevision: 'a'.repeat(64) }))).rejects.toThrow('Fatura değişti')
    await expect(service.reviewSellerInvoice(approve({ expectedRevision: '' }))).rejects.toThrow('Fatura sürümü gerekli')
    expect(prisma.orderSellerInvoice.update).not.toHaveBeenCalled()
  })

  it('does not move an approved invoice again on a repeated submission', async () => {
    const { prisma, service } = fixture({
      invoice: { reviewStatus: 'approved', invoiceNumber: 'GIB2026000000123', invoiceDate: new Date('2026-10-04T21:00:00Z') },
    })
    await expect(service.reviewSellerInvoice(approve({ invoiceDate: '2026-10-10' }))).rejects.toThrow('zaten onaylandı')
    await expect(service.reviewSellerInvoice(reject())).rejects.toThrow('zaten onaylandı')
    expect(prisma.orderSellerInvoice.update).not.toHaveBeenCalled()
    expect(syncInvoiceDueDateMock).not.toHaveBeenCalled()
  })

  it('returns not-found when the seller has not sent an invoice', async () => {
    const { service } = fixture({ invoice: null })
    await expect(service.reviewSellerInvoice(reject({ expectedRevision: 'b'.repeat(64) }))).rejects.toThrow()
  })

  it('rejects with a reason and notifies the seller on the seller panel', async () => {
    const { prisma, service } = fixture()
    await service.reviewSellerInvoice(reject())
    expect(prisma.orderSellerInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        reviewStatus: 'rejected', invoiceNumber: null, invoiceDate: null,
        reviewNote: 'KDV oranı ürünle uyuşmuyor; %20 ile yeniden kesin.',
      }),
    }))
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actionType: 'seller_invoice_rejected', reason: 'KDV oranı ürünle uyuşmuyor; %20 ile yeniden kesin.',
    }) })
    expect(recordNotificationMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
      eventKey: `seller-invoice-rejected:order-1:seller-1:${revision}`,
      userId: 'seller-user',
      type: 'seller_invoice_rejected',
      emailTo: 'seller@example.test',
      data: expect.objectContaining({
        orderId: 'order-1',
        orderNumber: '26050042',
        reason: 'KDV oranı ürünle uyuşmuyor; %20 ile yeniden kesin.',
        panelUrl: 'https://satici.hanuja.com.tr/siparisler/order-1',
      }),
    }))
    // A rejected invoice carries no due date; the payout stays blocked.
    expect(syncInvoiceDueDateMock).toHaveBeenCalledWith({ orderId: 'order-1', sellerId: 'seller-1' })
  })

  it('requires a meaningful rejection reason', async () => {
    const { prisma, service } = fixture()
    await expect(service.reviewSellerInvoice(reject({ note: 'yok' }))).rejects.toThrow('5 ile 1000')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('keeps the decision when the payout sync fails; eligibility re-reads the invoice anyway', async () => {
    const { prisma, service } = fixture()
    syncInvoiceDueDateMock.mockRejectedValueOnce(new Error('lock timeout'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(service.reviewSellerInvoice(approve())).resolves.toMatchObject({ reviewStatus: 'approved' })
    expect(prisma.orderSellerInvoice.update).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('[seller-invoice] Payout due date sync deferred', expect.anything())
    errorSpy.mockRestore()
  })
})
