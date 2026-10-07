import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { recordNotificationMock } = vi.hoisted(() => ({ recordNotificationMock: vi.fn() }))
vi.mock('../../../api/services/notification-outbox.service', () => ({ recordNotification: recordNotificationMock }))
vi.mock('../../../api/services/private-document-cleanup.service', () => ({
  schedulePrivateDocumentCleanup: vi.fn().mockResolvedValue(undefined),
  processPrivateDocumentCleanup: vi.fn(async ({ fileKey, deleteFile }) => deleteFile(fileKey)),
}))
vi.mock('../../../api/lib/r2', () => ({
  DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024,
  DOCUMENT_ALLOWED_MIME_TYPES: new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  deleteObject: vi.fn(), readObject: vi.fn(),
}))

import { createResendInvoiceService, verifyResendInvoiceWebhook } from '../../../api/services/resend-invoice.service'
import { handleResendInvoiceWebhook } from '../../../api/routes/resend-inbound'

const emailId = '56761188-7520-42d8-8898-ff6fc54ce618'
const attachmentId = '2a0c9ce0-3112-4728-976e-47ddcd16a318'
const alias = 'pfabc@fatura.hanuja.com.tr'
const secret = `whsec_${Buffer.from('invoice-test-secret-value-12345678').toString('base64')}`
const event = { type: 'email.received' as const, data: { email_id: emailId, from: 'seller@example.test', to: [alias], cc: [], bcc: [], subject: 'Fatura' } }
const pdf = '%PDF-1.7\ninvoice test\n%%EOF'

function fixture() {
  const storage = { write: vi.fn().mockResolvedValue({ key: 'private/v1/aa/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.bin' }), read: vi.fn(), exists: vi.fn(), delete: vi.fn() }
  const db: any = {
    inboundEmail: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'inbound-1', ...data })),
    },
    orderEmailAlias: {
      findMany: vi.fn().mockResolvedValue([{ id: 'alias-1', orderId: 'order-1', sellerId: 'seller-1', aliasEmail: alias }]),
      update: vi.fn(),
    },
    orderSellerInvoice: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(async ({ create }) => ({ id: 'invoice-1', createdAt: new Date(), ...create })) },
    orderSellerInvoicePolicy: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(async ({ create }) => ({ id: 'policy-1', ...create })) },
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    order: { findUnique: vi.fn().mockResolvedValue({
      id: 'order-1', publicNumber: 26050080, customerId: 'customer-1',
      customer: { email: 'customer@example.test', name: 'Customer' }, address: { fullName: 'Customer' }, lines: [],
    }) },
    seller: { findUnique: vi.fn().mockResolvedValue({ displayName: 'Seller' }) },
  }
  db.$transaction = vi.fn((callback: any) => callback(db))
  const metadata = { has_more: false, data: [{
    id: attachmentId, filename: 'fatura.pdf', content_type: 'application/pdf', size: pdf.length,
    download_url: `https://inbound-cdn.resend.com/${emailId}/attachments/${attachmentId}?signature=test`,
  }] }
  const fetcher = vi.fn().mockImplementation(async (url: URL) => new Response(
    url.hostname === 'api.resend.com' ? JSON.stringify(metadata) : pdf,
    { headers: { 'content-type': url.hostname === 'api.resend.com' ? 'application/json' : 'application/pdf' } },
  ))
  return { db, storage, metadata, fetcher, service: createResendInvoiceService({ prisma: db, storage, fetcher }) }
}

function signedRequest(body = JSON.stringify(event), timestamp = String(Math.floor(Date.now() / 1000))) {
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`event-1.${timestamp}.${body}`).digest('base64')
  return new Request('https://www.hanuja.com.tr/api/inbound/resend', {
    method: 'POST', body,
    headers: { 'svix-id': 'event-1', 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
  })
}

describe('Resend invoice PDF receiving', () => {
  beforeEach(() => {
    vi.stubEnv('INVOICE_ALIASING_ENABLED', 'true')
    vi.stubEnv('RESEND_RECEIVING_API_KEY', 'test-receiving-key')
    vi.stubEnv('RESEND_INBOUND_WEBHOOK_SECRET', secret)
    recordNotificationMock.mockReset()
    recordNotificationMock.mockResolvedValue(undefined)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('verifies original bytes and rejects forged, expired and wrong-event webhooks', async () => {
    const request = signedRequest()
    expect(verifyResendInvoiceWebhook(await request.text(), request.headers, secret).data.email_id).toBe(emailId)
    expect(() => verifyResendInvoiceWebhook(JSON.stringify(event), new Headers(), secret)).toThrow()
    const expired = signedRequest(JSON.stringify(event), '1')
    expect(() => verifyResendInvoiceWebhook(JSON.stringify(event), expired.headers, secret)).toThrow()
    const altered = signedRequest()
    expect(() => verifyResendInvoiceWebhook(JSON.stringify(event) + ' ', altered.headers, secret)).toThrow()
    const wrongBody = JSON.stringify({ ...event, type: 'email.delivered' })
    expect(() => verifyResendInvoiceWebhook(wrongBody, signedRequest(wrongBody).headers, secret)).toThrow()
  })

  it('downloads the PDF and atomically attaches it to its order/seller with a customer notification', async () => {
    const { db, storage, fetcher, service } = fixture()
    expect((await service.ingest(event)).status).toBe('processed')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer test-receiving-key' })
    expect(fetcher.mock.calls[1]?.[1]?.headers).toBeUndefined()
    expect(storage.write).toHaveBeenCalledWith(new Uint8Array(Buffer.from(pdf)))
    expect(db.inboundEmail.create).toHaveBeenCalledWith({ data: expect.objectContaining({ messageId: `resend:${emailId}`, status: 'processed' }) })
    expect(db.orderSellerInvoice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId_sellerId: { orderId: 'order-1', sellerId: 'seller-1' } },
      create: expect.objectContaining({ mimeType: 'application/pdf', source: 'inbound_email', sizeBytes: pdf.length }),
    }))
    expect(recordNotificationMock).toHaveBeenCalledTimes(1)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('ignores duplicates before downloading or notifying', async () => {
    const { db, storage, fetcher, service } = fixture()
    db.inboundEmail.findUnique.mockResolvedValue({ id: 'existing' })
    expect((await service.ingest(event)).status).toBe('duplicate')
    expect(fetcher).not.toHaveBeenCalled()
    expect(storage.write).not.toHaveBeenCalled()
    expect(recordNotificationMock).not.toHaveBeenCalled()
  })

  it.each([{ aliases: [] }, { aliases: [{ id: 'a' }, { id: 'b' }] }])('does not download for unknown or ambiguous aliases: $aliases', async ({ aliases }) => {
    const { db, fetcher, service } = fixture()
    db.orderEmailAlias.findMany.mockResolvedValue(aliases)
    const result = await service.ingest(event)
    expect(result.status).toBe(aliases.length ? 'ambiguous_alias' : 'unknown_alias')
    expect(fetcher).not.toHaveBeenCalled()
    expect(db.orderSellerInvoice.upsert).not.toHaveBeenCalled()
  })

  it('uses the actual receiving recipient for forwarded messages', async () => {
    const { db, service } = fixture()
    await service.ingest({ ...event, data: { ...event.data, to: ['another@example.test'], received_for: [alias.toUpperCase()] } })
    expect(db.orderEmailAlias.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ aliasEmail: { in: [alias] } }) }))
  })

  it.each(['application/xml', 'image/png', 'text/html'])('records %s without touching the invoice', async contentType => {
    const { db, storage, metadata, fetcher, service } = fixture()
    metadata.data[0]!.content_type = contentType
    expect((await service.ingest(event)).status).toBe('no_valid_attachment')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(storage.write).not.toHaveBeenCalled()
    expect(db.orderSellerInvoice.upsert).not.toHaveBeenCalled()
  })

  it('rejects a declared oversized PDF and a fake PDF without storage writes', async () => {
    const first = fixture()
    first.metadata.data[0]!.size = 20 * 1024 * 1024 + 1
    expect((await first.service.ingest(event)).status).toBe('no_valid_attachment')
    expect(first.storage.write).not.toHaveBeenCalled()
    const second = fixture()
    second.fetcher.mockImplementation(async (url: URL) => new Response(url.hostname === 'api.resend.com' ? JSON.stringify(second.metadata) : '<html>not a PDF</html>'))
    expect((await second.service.ingest(event)).status).toBe('no_valid_attachment')
    expect(second.storage.write).not.toHaveBeenCalled()
  })

  it('enforces actual download size even if metadata underreports it', async () => {
    const { storage, metadata, fetcher, service } = fixture()
    fetcher.mockImplementation(async (url: URL) => new Response(url.hostname === 'api.resend.com'
      ? JSON.stringify(metadata) : new Uint8Array(20 * 1024 * 1024 + 1)))
    expect((await service.ingest(event)).status).toBe('no_valid_attachment')
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('retries API and storage failures without marking the email processed', async () => {
    const f = fixture()
    f.fetcher.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await expect(f.service.ingest(event)).rejects.toThrow('RESEND_ATTACHMENT_API_429')
    expect(f.db.inboundEmail.create).not.toHaveBeenCalled()
    f.storage.write.mockRejectedValueOnce(new Error('storage temporarily unavailable'))
    await expect(f.service.ingest(event)).rejects.toThrow('storage temporarily unavailable')
    expect(f.db.inboundEmail.create).not.toHaveBeenCalled()
    expect((await f.service.ingest(event)).status).toBe('processed')
  })

  it('returns a duplicate and cleans the losing file after a concurrent unique-message conflict', async () => {
    const f = fixture()
    f.db.inboundEmail.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' })
    f.db.inboundEmail.create.mockRejectedValue({ code: 'P2002' })
    expect((await f.service.ingest(event)).status).toBe('duplicate')
    expect(f.db.orderSellerInvoice.upsert).not.toHaveBeenCalled()
    expect(recordNotificationMock).not.toHaveBeenCalled()
    expect(f.storage.delete).toHaveBeenCalledWith('private/v1/aa/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.bin')
  })

  it('rejects webhook requests before DB access and acknowledges terminal outcomes', async () => {
    const factory = vi.fn()
    const bad = new Request('https://www.hanuja.com.tr/api/inbound/resend', { method: 'POST', body: '{}' })
    expect((await handleResendInvoiceWebhook(bad, factory)).status).toBe(400)
    expect(factory).not.toHaveBeenCalled()
    const f = fixture()
    f.db.orderEmailAlias.findMany.mockResolvedValue([])
    expect((await handleResendInvoiceWebhook(signedRequest(), () => f.db)).status).toBe(200)
    vi.stubEnv('INVOICE_ALIASING_ENABLED', 'false')
    expect((await handleResendInvoiceWebhook(signedRequest(), factory)).status).toBe(503)
  })

  it('returns 503 for transient download errors so Resend can retry', async () => {
    const f = fixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    expect((await handleResendInvoiceWebhook(signedRequest(), () => f.db)).status).toBe(503)
    expect(f.db.inboundEmail.create).not.toHaveBeenCalled()
  })
})
