import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  verifyEmailWebhook,
  recordEmailProviderEvent,
  reconcileEmailProviderEvents,
} from '../../../api/services/email-provider-event.service'
const secret = `whsec_${Buffer.from('test-secret-not-for-production-123').toString('base64')}`
const now = Date.now()
const raw = JSON.stringify({
  type: 'email.delivered',
  created_at: new Date(now).toISOString(),
  data: { email_id: 'provider1', message_id: '<m@test>' },
})
function signed(timestamp = String(Math.floor(now / 1000))) {
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`event1.${timestamp}.${raw}`)
    .digest('base64')
  return new Headers({
    'svix-id': 'event1',
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  })
}
describe('provider delivery events', () => {
  it('verifies the original raw body and rejects forged, altered and expired requests', () => {
    expect(verifyEmailWebhook(raw, signed(), secret, now).id).toBe('event1')
    expect(() => verifyEmailWebhook(raw + ' ', signed(), secret, now)).toThrow(
      'INVALID_WEBHOOK_SIGNATURE',
    )
    expect(() => verifyEmailWebhook(raw, signed('1'), secret, now)).toThrow(
      'INVALID_WEBHOOK_SIGNATURE',
    )
    expect(() => verifyEmailWebhook(raw, new Headers(), secret, now)).toThrow()
  })
  it('stores a unique provider event without persisting recipient or message content', async () => {
    const db = {
      emailProviderEvent: { upsert: vi.fn() },
      notificationDelivery: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const event = verifyEmailWebhook(raw, signed(), secret, now)
    await recordEmailProviderEvent(db as never, event)
    await recordEmailProviderEvent(db as never, event)
    expect(db.emailProviderEvent.upsert).toHaveBeenCalledWith({
      where: { id: 'event1' },
      update: {},
      create: {
        id: 'event1',
        providerMessageId: 'provider1',
        messageId: '<m@test>',
        type: 'email.delivered',
        occurredAt: expect.any(Date),
      },
    })
  })
  it('retains bounce/complaint precedence over later delivered or sent events', async () => {
    const db = {
      notificationDelivery: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'd1', messageId: '<m@test>' }),
        updateMany: vi.fn(),
      },
      emailProviderEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            type: 'email.sent',
            occurredAt: new Date(),
            providerMessageId: 'p1',
          },
          {
            type: 'email.complained',
            occurredAt: new Date(1),
            providerMessageId: 'p1',
          },
        ]),
      },
    }
    await reconcileEmailProviderEvents(db as never, 'd1')
    expect(db.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transportStatus: 'complained' }),
      }),
    )
  })
})
