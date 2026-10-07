import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { ValidationError } from '../lib/errors'
import { DOCUMENT_MAX_SIZE_BYTES } from '../lib/r2'
import type { PrivateDocumentStorage } from '../lib/private-document-storage'
import { verifyEmailWebhookSignature } from './email-provider-event.service'
import { createOrderDocumentService } from './order-document.service'

const receivedEmailSchema = z.object({
  type: z.literal('email.received'),
  data: z.object({
    email_id: z.string().uuid(),
    from: z.string().max(1000),
    subject: z.string().max(2000).optional(),
    to: z.array(z.string().max(1000)).max(100).default([]),
    cc: z.array(z.string().max(1000)).max(100).default([]),
    bcc: z.array(z.string().max(1000)).max(100).default([]),
    received_for: z.array(z.string().max(1000)).max(100).optional(),
  }),
})

const attachmentListSchema = z.object({
  has_more: z.boolean(),
  data: z.array(z.object({
    id: z.string().uuid(),
    filename: z.string().max(1000).nullable(),
    content_type: z.string(),
    size: z.number().int().nonnegative(),
    download_url: z.string().url(),
  })).max(100),
})

export function verifyResendInvoiceWebhook(raw: string, headers: Headers, secret: string) {
  verifyEmailWebhookSignature(raw, headers, secret)
  return receivedEmailSchema.parse(JSON.parse(raw))
}

export function createResendInvoiceService({ prisma, storage, fetcher = fetch }: {
  prisma: PrismaClient
  storage?: PrivateDocumentStorage
  fetcher?: typeof fetch
}) {
  const documents = createOrderDocumentService({ prisma, ...(storage ? { storage } : {}) })

  async function loadPdf(emailId: string) {
    const apiKey = process.env.RESEND_RECEIVING_API_KEY
    if (!apiKey) throw new Error('RESEND_RECEIVING_NOT_CONFIGURED')
    let after = ''
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(`https://api.resend.com/emails/receiving/${emailId}/attachments`)
      url.searchParams.set('limit', '100')
      if (after) url.searchParams.set('after', after)
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`RESEND_ATTACHMENT_API_${response.status}`)
      const attachments = attachmentListSchema.parse(await response.json())
      const pdf = attachments.data.find(a => a.content_type.toLowerCase() === 'application/pdf')
      if (pdf) {
        if (pdf.size > DOCUMENT_MAX_SIZE_BYTES) throw new ValidationError('PDF eki 20 MB sınırını aşıyor.')
        const downloadUrl = new URL(pdf.download_url)
        // URLs come from the authenticated provider API, never from the email body.
        if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'inbound-cdn.resend.com' ||
            downloadUrl.username || downloadUrl.password || (downloadUrl.port && downloadUrl.port !== '443')) {
          throw new Error('INVALID_RESEND_ATTACHMENT_URL')
        }
        const download = await fetcher(downloadUrl, {
          signal: AbortSignal.timeout(30000), redirect: 'error',
        })
        if (!download.ok) throw new Error(`RESEND_ATTACHMENT_DOWNLOAD_${download.status}`)
        if (Number(download.headers.get('content-length') ?? 0) > DOCUMENT_MAX_SIZE_BYTES) {
          await download.body?.cancel()
          throw new ValidationError('PDF eki 20 MB sınırını aşıyor.')
        }
        const reader = download.body?.getReader()
        if (!reader) throw new Error('RESEND_ATTACHMENT_BODY_MISSING')
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > DOCUMENT_MAX_SIZE_BYTES) {
            await reader.cancel()
            throw new ValidationError('PDF eki 20 MB sınırını aşıyor.')
          }
          chunks.push(chunk.value)
        }
        return {
          fileName: (pdf.filename || 'fatura.pdf').replace(/[\r\n/\\]/g, '_'),
          mimeType: 'application/pdf',
          body: new Uint8Array(Buffer.concat(chunks)),
        }
      }
      if (!attachments.has_more) return null
      const next = attachments.data.at(-1)?.id
      if (!next || next === after) throw new Error('INVALID_RESEND_ATTACHMENT_PAGINATION')
      after = next
    }
    throw new Error('RESEND_ATTACHMENT_PAGE_LIMIT')
  }

  return {
    ingest(event: z.infer<typeof receivedEmailSchema>) {
      const data = event.data
      const recipients = data.received_for?.length
        ? data.received_for
        : [...data.to, ...data.cc, ...data.bcc]
      return documents.ingestInboundInvoiceEmail({
        messageId: `resend:${data.email_id}`,
        recipients: recipients.map(value => value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? value),
        fromEmail: data.from,
        subject: data.subject ?? null,
        loadAttachment: () => loadPdf(data.email_id),
      })
    },
  }
}
