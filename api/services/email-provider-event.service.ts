import type { PrismaClient } from '@prisma/client'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const eventSchema = z.object({
  type: z.enum([
    'email.sent',
    'email.delivered',
    'email.bounced',
    'email.complained',
    'email.failed',
    'email.delivery_delayed',
  ]),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().min(1).max(200),
    message_id: z.string().max(500).optional(),
  }),
})

export function verifyEmailWebhook(
  raw: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const id = headers.get('svix-id') ?? ''
  const timestamp = headers.get('svix-timestamp') ?? ''
  if (
    !id ||
    id.length > 200 ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    throw new Error('INVALID_WEBHOOK_SIGNATURE')
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  if (key.length < 16) throw new Error('INVALID_WEBHOOK_SECRET')
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest()
  const valid = (headers.get('svix-signature') ?? '')
    .split(' ')
    .some((part) => {
      const [version, value] = part.split(',')
      if (version !== 'v1' || !value) return false
      const actual = Buffer.from(value, 'base64')
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      )
    })
  if (!valid) throw new Error('INVALID_WEBHOOK_SIGNATURE')
  return { id, ...eventSchema.parse(JSON.parse(raw)) }
}

export async function reconcileEmailProviderEvents(
  prisma: PrismaClient,
  deliveryId: string,
) {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
  })
  if (!delivery) return
  const matches = [
    ...(delivery.providerMessageId
      ? [{ providerMessageId: delivery.providerMessageId }]
      : []),
    ...(delivery.messageId ? [{ messageId: delivery.messageId }] : []),
  ]
  if (!matches.length) return
  const events = await prisma.emailProviderEvent.findMany({
    where: { OR: matches },
    orderBy: { occurredAt: 'desc' },
    take: 100,
  })
  // Complaint/bounce must never be erased by an older or out-of-order sent event.
  const event =
    events.find((e) => e.type === 'email.complained') ??
    events.find(
      (e) => e.type === 'email.bounced' || e.type === 'email.failed',
    ) ??
    events.find((e) => e.type === 'email.delivered') ??
    events[0]
  if (!event) return
  const transportStatus = {
    'email.sent': 'unknown',
    'email.delivered': 'delivered',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'bounced',
    'email.delivery_delayed': 'unknown',
  }[event.type]
  // Enforce precedence in the write too: concurrent webhook handlers can have
  // read different event snapshots before either update is committed.
  const protectedStatuses =
    transportStatus === 'complained'
      ? []
      : transportStatus === 'bounced'
        ? ['complained']
        : transportStatus === 'delivered'
          ? ['bounced', 'complained']
          : ['delivered', 'bounced', 'complained']
  await prisma.notificationDelivery.updateMany({
    where: { id: deliveryId, transportStatus: { notIn: protectedStatuses } },
    data: {
      providerMessageId: event.providerMessageId,
      providerEventAt: event.occurredAt,
      transportStatus: transportStatus ?? 'unknown',
      status: 'sent',
      ...(event.type === 'email.delivered'
        ? { deliveredAt: event.occurredAt }
        : {}),
      lastError: null,
    },
  })
}

export async function recordEmailProviderEvent(
  prisma: PrismaClient,
  event: ReturnType<typeof verifyEmailWebhook>,
) {
  await prisma.emailProviderEvent.upsert({
    where: { id: event.id },
    update: {},
    create: {
      id: event.id,
      providerMessageId: event.data.email_id,
      messageId: event.data.message_id ?? null,
      type: event.type,
      occurredAt: new Date(event.created_at),
    },
  })
  const rows = await prisma.notificationDelivery.findMany({
    where: {
      channel: 'email',
      OR: [
        { providerMessageId: event.data.email_id },
        ...(event.data.message_id
          ? [{ messageId: event.data.message_id }]
          : []),
      ],
    },
    select: { id: true },
  })
  for (const row of rows) await reconcileEmailProviderEvents(prisma, row.id)
}
