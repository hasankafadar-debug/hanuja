/**
 * Satıcı Hanuja modeli — permission boundaries of the invoice admin routes.
 * Only an admin session can approve/reject the seller's invoice to Hanuja or manage
 * Hanuja's customer invoice; the actor always comes from the session, never the body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  csrf: vi.fn(),
  review: vi.fn(),
  uploadCustomerInvoice: vi.fn(),
  removeCustomerInvoice: vi.fn(),
  getCustomerInvoice: vi.fn(),
  getCustomerInvoiceFile: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: mocks.csrf }))
vi.mock('@hanuja/api/lib/r2', () => ({ DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024 }))
vi.mock('@hanuja/api/services/order-document.service', () => ({
  createOrderDocumentService: () => ({ reviewSellerInvoice: mocks.review }),
}))
vi.mock('@hanuja/api/services/customer-invoice.service', () => ({
  createCustomerInvoiceService: () => ({
    uploadForAdmin: mocks.uploadCustomerInvoice,
    removeForAdmin: mocks.removeCustomerInvoice,
    getForAdmin: mocks.getCustomerInvoice,
    getFileForAdmin: mocks.getCustomerInvoiceFile,
  }),
}))

import { POST as reviewPost } from '../../apps/admin-panel/src/app/api/admin/orders/[id]/invoices/[sellerId]/review/route'
import {
  DELETE as customerInvoiceDelete,
  POST as customerInvoicePost,
} from '../../apps/admin-panel/src/app/api/admin/orders/[id]/customer-invoice/route'

const revision = `"${'a'.repeat(64)}"`
const reviewContext = { params: Promise.resolve({ id: 'order-1', sellerId: 'seller-1' }) }
const orderContext = { params: Promise.resolve({ id: 'order-1' }) }

function reviewRequest(body: unknown, match: string | null = revision) {
  return new NextRequest('https://admin.example/api/admin/orders/order-1/invoices/seller-1/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(match ? { 'If-Match': match } : {}) },
    body: JSON.stringify(body),
  })
}

function uploadRequest() {
  const body = new FormData()
  body.append('file', new File(['%PDF-1.7\ntest'], 'fatura.pdf', { type: 'application/pdf' }))
  return new NextRequest('https://admin.example/api/admin/orders/order-1/customer-invoice', { method: 'POST', body })
}

const approval = { decision: 'approve', invoiceNumber: 'GIB2026000000123', invoiceDate: '2026-10-05' }

describe('seller invoice review route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.csrf.mockReturnValue(null)
    mocks.review.mockResolvedValue({ reviewStatus: 'approved' })
  })

  it('rejects anonymous and seller sessions before the service', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await reviewPost(reviewRequest(approval), reviewContext)).status).toBe(401)
    mocks.session.mockResolvedValueOnce({ user: { id: 'seller-user', role: 'seller' } })
    expect((await reviewPost(reviewRequest(approval), reviewContext)).status).toBe(403)
    mocks.session.mockResolvedValueOnce({ user: { id: 'customer-1', role: 'customer' } })
    expect((await reviewPost(reviewRequest(approval), reviewContext)).status).toBe(403)
    expect(mocks.review).not.toHaveBeenCalled()
  })

  it('stops a cross-site request', async () => {
    mocks.csrf.mockReturnValueOnce(NextResponse.json({ error: 'csrf' }, { status: 403 }))
    expect((await reviewPost(reviewRequest(approval), reviewContext)).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.review).not.toHaveBeenCalled()
  })

  it('requires the file revision and a complete decision', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    expect((await reviewPost(reviewRequest(approval, null), reviewContext)).status).toBe(422)
    expect((await reviewPost(reviewRequest({ decision: 'approve', invoiceNumber: 'X1' }), reviewContext)).status).toBe(422)
    expect((await reviewPost(reviewRequest({ decision: 'reject', note: 'kısa' }), reviewContext)).status).toBe(422)
    expect((await reviewPost(reviewRequest({ decision: 'pay' }), reviewContext)).status).toBe(422)
    expect(mocks.review).not.toHaveBeenCalled()
  })

  it('passes the session admin as actor even when the body names someone else', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const response = await reviewPost(reviewRequest({ ...approval, actorId: 'attacker', reviewStatus: 'approved' }), reviewContext)
    expect(response.status).toBe(200)
    expect(mocks.review).toHaveBeenCalledWith({
      orderId: 'order-1', sellerId: 'seller-1', actorId: 'admin-1', expectedRevision: revision,
      decision: 'approve', invoiceNumber: 'GIB2026000000123', invoiceDate: '2026-10-05',
    })
  })
})

describe("Hanuja's customer invoice admin route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.csrf.mockReturnValue(null)
  })

  it('refuses non-admin sessions for upload and removal', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'seller-user', role: 'seller' } })
    expect((await customerInvoicePost(uploadRequest(), orderContext)).status).toBe(403)
    const removal = new NextRequest('https://admin.example/api/admin/orders/order-1/customer-invoice', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', 'If-Match': revision },
      body: JSON.stringify({ reason: 'Yanlış siparişe yüklendi' }),
    })
    expect((await customerInvoiceDelete(removal, orderContext)).status).toBe(403)
    expect(mocks.uploadCustomerInvoice).not.toHaveBeenCalled()
    expect(mocks.removeCustomerInvoice).not.toHaveBeenCalled()
  })

  it('uploads as the session admin', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    mocks.uploadCustomerInvoice.mockResolvedValue({ id: 'customer-invoice-1' })
    expect((await customerInvoicePost(uploadRequest(), orderContext)).status).toBe(201)
    expect(mocks.uploadCustomerInvoice).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1', actorId: 'admin-1', fileName: 'fatura.pdf', mimeType: 'application/pdf',
    }))
  })
})
