import type { PrismaClient } from '@prisma/client'
import { createResendInvoiceService, verifyResendInvoiceWebhook } from '../services/resend-invoice.service'
import { isInvoiceAliasingEnabled } from '../services/order-document.service'

export async function handleResendInvoiceWebhook(request: Request, prisma: () => PrismaClient) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET
  if (!secret || !isInvoiceAliasingEnabled()) {
    return new Response('Invoice receiving not configured', { status: 503 })
  }
  if (Number(request.headers.get('content-length') ?? 0) > 65536) {
    return new Response(null, { status: 413 })
  }
  const reader = request.body?.getReader()
  if (!reader) return new Response(null, { status: 400 })
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 65536) {
      await reader.cancel()
      return new Response(null, { status: 413 })
    }
    chunks.push(chunk.value)
  }
  let event: ReturnType<typeof verifyResendInvoiceWebhook>
  try {
    event = verifyResendInvoiceWebhook(Buffer.concat(chunks).toString('utf8'), request.headers, secret)
  } catch {
    return new Response('Invalid webhook', { status: 400 })
  }
  try {
    const result = await createResendInvoiceService({ prisma: prisma() }).ingest(event)
    // Non-PDF and unknown recipients are terminal outcomes, not retryable failures.
    return Response.json({ received: true, status: result.status })
  } catch {
    console.error('[resend-inbound] Invoice processing failed', { emailId: event.data.email_id })
    return new Response('Invoice processing failed', { status: 503 })
  }
}
