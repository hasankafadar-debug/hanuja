import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DomainError, ForbiddenError } from '../../../api/lib/errors'

const mocks = vi.hoisted(() => ({
  prisma: { seller: { findUnique: vi.fn() } },
  session: vi.fn(),
  csrf: vi.fn(),
  uploadSeller: vi.fn(),
  uploadAdmin: vi.fn(),
  removeSeller: vi.fn(),
  removeAdmin: vi.fn(),
  getSeller: vi.fn(),
  getAdmin: vi.fn(),
  read: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: () => mocks.prisma,
}))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: mocks.csrf }))
vi.mock('@hanuja/api/lib/r2', () => ({
  DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024,
}))
vi.mock('@hanuja/api/services/order-document.service', () => ({
  createOrderDocumentService: () => ({
    uploadInvoiceForSeller: mocks.uploadSeller,
    uploadInvoiceForAdmin: mocks.uploadAdmin,
    removeInvoiceForSeller: mocks.removeSeller,
    removeInvoiceForAdmin: mocks.removeAdmin,
    getInvoiceForSeller: mocks.getSeller,
    getInvoiceForAdmin: mocks.getAdmin,
    readInvoiceFile: mocks.read,
  }),
}))

import {
  POST as sellerUpload,
  DELETE as sellerDelete,
  GET as sellerDownload,
} from '../../../apps/seller-panel/src/app/api/seller/orders/[id]/invoice/route'
import {
  POST as adminUpload,
  DELETE as adminDelete,
  GET as adminDownload,
} from '../../../apps/admin-panel/src/app/api/admin/orders/[id]/invoices/[sellerId]/route'

const revision = `"${'a'.repeat(64)}"`
const sellerContext = { params: Promise.resolve({ id: 'order-1' }) }
const adminContext = {
  params: Promise.resolve({ id: 'order-1', sellerId: 'seller-1' }),
}

function deleteRequest(
  reason: unknown = 'Yanlış dosya yüklendi.',
  match: string | null = revision,
) {
  return new NextRequest('https://panel.example/api/invoice', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(match ? { 'If-Match': match } : {}),
    },
    body: JSON.stringify({ reason }),
  })
}

function uploadRequest(
  match: string | null = revision,
  reason: string | null = 'Doğru fatura ile değiştirildi.',
) {
  const body = new FormData()
  body.append(
    'file',
    new File(['%PDF-1.7\ntest'], 'fatura.pdf', { type: 'application/pdf' }),
  )
  if (reason) body.append('reason', reason)
  return new NextRequest('https://panel.example/api/invoice', {
    method: 'POST',
    body,
    headers: match ? { 'If-Match': match } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({
    user: { id: 'seller-user', role: 'seller' },
  })
  mocks.prisma.seller.findUnique.mockResolvedValue({
    id: 'seller-1',
    status: 'active',
  })
  mocks.csrf.mockReturnValue(null)
  mocks.uploadSeller.mockResolvedValue({ id: 'invoice-1' })
  mocks.uploadAdmin.mockResolvedValue({ id: 'invoice-1' })
  mocks.removeSeller.mockResolvedValue({ removed: true })
  mocks.removeAdmin.mockResolvedValue({ removed: true })
})

describe('seller invoice management routes', () => {
  it('passes the authenticated seller, actor, revision and replacement reason to upload', async () => {
    const response = await sellerUpload(uploadRequest(), sellerContext)
    expect(response.status).toBe(201)
    expect(mocks.uploadSeller).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        sellerId: 'seller-1',
        actorId: 'seller-user',
        expectedRevision: revision,
        reason: 'Doğru fatura ile değiştirildi.',
        fileName: 'fatura.pdf',
        mimeType: 'application/pdf',
        body: expect.any(Uint8Array),
      }),
    )
  })

  it('allows the first upload to pass without a revision or replacement reason', async () => {
    const response = await sellerUpload(
      uploadRequest(null, null),
      sellerContext,
    )
    expect(response.status).toBe(201)
    expect(mocks.uploadSeller).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: null, reason: null }),
    )
  })

  it('uses only the seller resolved from the session for deletion', async () => {
    const request = new NextRequest('https://panel.example/api/invoice', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'If-Match': revision },
      body: JSON.stringify({
        reason: '  Yanlış dosya yüklendi.  ',
        sellerId: 'other-seller',
        actorId: 'other-user',
      }),
    })
    const response = await sellerDelete(request, sellerContext)
    expect(response.status).toBe(200)
    expect(mocks.removeSeller).toHaveBeenCalledWith({
      orderId: 'order-1',
      sellerId: 'seller-1',
      actorId: 'seller-user',
      expectedRevision: revision,
      reason: 'Yanlış dosya yüklendi.',
    })
  })

  it.each([null, 123, '', '    ', 'kısa'])(
    'rejects invalid deletion reason %s',
    async (reason) => {
      const response = await sellerDelete(deleteRequest(reason), sellerContext)
      expect(response.status).toBe(422)
      expect(mocks.removeSeller).not.toHaveBeenCalled()
    },
  )

  it('rejects deletion with no reason', async () => {
    const response = await sellerDelete(
      new NextRequest('https://panel.example/api/invoice', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      sellerContext,
    )
    expect(response.status).toBe(422)
    expect(mocks.removeSeller).not.toHaveBeenCalled()
  })

  it('blocks mutations before reading content when CSRF verification fails', async () => {
    mocks.csrf.mockReturnValue(new Response(null, { status: 403 }))
    expect((await sellerDelete(deleteRequest(), sellerContext)).status).toBe(
      403,
    )
    expect((await sellerUpload(uploadRequest(), sellerContext)).status).toBe(
      403,
    )
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.removeSeller).not.toHaveBeenCalled()
    expect(mocks.uploadSeller).not.toHaveBeenCalled()
  })

  it('requires a session and an eligible seller account', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await sellerDelete(deleteRequest(), sellerContext)).status).toBe(
      401,
    )
    mocks.prisma.seller.findUnique.mockResolvedValueOnce({
      id: 'seller-1',
      status: 'pending',
    })
    expect((await sellerDelete(deleteRequest(), sellerContext)).status).toBe(
      403,
    )
    expect(mocks.removeSeller).not.toHaveBeenCalled()
  })

  it.each([428, 412, 403, 503])(
    'preserves service status %s for a rejected mutation',
    async (status) => {
      mocks.removeSeller.mockRejectedValueOnce(
        new DomainError('Fatura işlemi reddedildi.', 'INVOICE_ERROR', status),
      )
      expect((await sellerDelete(deleteRequest(), sellerContext)).status).toBe(
        status,
      )
    },
  )

  it('preserves download disposition and the ownership-checked file lookup', async () => {
    mocks.getSeller.mockResolvedValue({
      fileKey: 'private-key',
      fileName: 'fatura.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
    })
    mocks.read.mockResolvedValue({ body: new Uint8Array([1, 2, 3, 4, 5]) })
    const response = await sellerDownload(
      new NextRequest('https://panel.example/api/invoice?download=1'),
      sellerContext,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(mocks.getSeller).toHaveBeenCalledWith('order-1', 'seller-1')
  })
})

describe('admin invoice management routes', () => {
  beforeEach(() =>
    mocks.session.mockResolvedValue({
      user: { id: 'admin-user', role: 'admin' },
    }),
  )

  it('allows an admin to upload on behalf of the selected seller', async () => {
    expect((await adminUpload(uploadRequest(), adminContext)).status).toBe(201)
    expect(mocks.uploadAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        sellerId: 'seller-1',
        actorId: 'admin-user',
        expectedRevision: revision,
        reason: 'Doğru fatura ile değiştirildi.',
      }),
    )
  })

  it('passes the admin identity and conditional deletion to the service', async () => {
    expect((await adminDelete(deleteRequest(), adminContext)).status).toBe(200)
    expect(mocks.removeAdmin).toHaveBeenCalledWith({
      orderId: 'order-1',
      sellerId: 'seller-1',
      actorId: 'admin-user',
      expectedRevision: revision,
      reason: 'Yanlış dosya yüklendi.',
    })
  })

  it('blocks customer and seller roles for both admin mutations', async () => {
    mocks.session.mockResolvedValue({
      user: { id: 'seller-user', role: 'seller' },
    })
    expect((await adminUpload(uploadRequest(), adminContext)).status).toBe(403)
    expect((await adminDelete(deleteRequest(), adminContext)).status).toBe(403)
    expect(mocks.uploadAdmin).not.toHaveBeenCalled()
    expect(mocks.removeAdmin).not.toHaveBeenCalled()
  })

  it('blocks both admin mutations when CSRF verification fails', async () => {
    mocks.csrf.mockReturnValue(new Response(null, { status: 403 }))
    expect((await adminUpload(uploadRequest(), adminContext)).status).toBe(403)
    expect((await adminDelete(deleteRequest(), adminContext)).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
  })

  it('keeps other-seller/order access enforcement in the shared service', async () => {
    mocks.uploadAdmin.mockRejectedValueOnce(new ForbiddenError())
    expect((await adminUpload(uploadRequest(), adminContext)).status).toBe(403)
  })

  it('rejects invalid deletion reasons without calling the service', async () => {
    expect((await adminDelete(deleteRequest('abc'), adminContext)).status).toBe(
      422,
    )
    expect(mocks.removeAdmin).not.toHaveBeenCalled()
  })

  it('retains admin file viewing and download', async () => {
    mocks.getAdmin.mockResolvedValue({
      fileKey: 'private-key',
      fileName: 'fatura.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
    })
    mocks.read.mockResolvedValue({ body: new Uint8Array([1, 2, 3, 4, 5]) })
    const response = await adminDownload(
      new NextRequest('https://panel.example/api/invoice'),
      adminContext,
    )
    expect(response.headers.get('content-disposition')).toContain('inline;')
    expect(mocks.getAdmin).toHaveBeenCalledWith('order-1', 'seller-1')
  })
})
