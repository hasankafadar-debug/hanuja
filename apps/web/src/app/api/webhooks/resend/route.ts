import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  recordEmailProviderEvent,
  verifyEmailWebhook,
} from '@hanuja/api/services/email-provider-event.service'

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return new Response('Webhook not configured', { status: 503 })
  if (Number(request.headers.get('content-length') ?? 0) > 65536)
    return new Response(null, { status: 413 })
  const reader = request.body?.getReader()
  if (!reader) return new Response(null, { status: 400 })
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > 65536) {
      await reader.cancel()
      return new Response(null, { status: 413 })
    }
    chunks.push(part.value)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  let event: ReturnType<typeof verifyEmailWebhook>
  try {
    event = verifyEmailWebhook(raw, request.headers, secret)
  } catch {
    return new Response('Invalid webhook', { status: 400 })
  }
  try {
    await recordEmailProviderEvent(createPrismaForRoute(), event)
    return Response.json({ received: true })
  } catch {
    return new Response('Webhook persistence failed', { status: 503 })
  }
}
