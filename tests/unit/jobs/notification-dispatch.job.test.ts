import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  send: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  outbox: vi.fn(),
  consent: vi.fn(),
  records: new Map<
    string,
    Record<string, unknown> & {
      id: string
      status: string
      transportStatus: string
      attemptCount: number
    }
  >(),
}))
vi.mock('bullmq', () => ({ Worker: vi.fn() }))
vi.mock('../../../api/lib/redis', () => ({ redis: {} }))
vi.mock('../../../api/lib/queue', () => ({
  QUEUE_NAMES: {
    NOTIFICATION_DISPATCH: 'notification-dispatch',
    NOTIFICATION_BULK: 'notification-bulk',
  },
}))
vi.mock('../../../api/lib/mailer', () => ({ sendEmail: mocks.send }))
vi.mock('../../../api/services/email-provider-event.service', () => ({
  reconcileEmailProviderEvents: vi.fn(),
}))
vi.mock('../../../api/lib/prisma', () => {
  const tx = {
    notification: { create: mocks.create },
    notificationDelivery: {
      upsert: mocks.upsert,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  }
  return {
    prisma: {
      ...tx,
      user: { findUnique: mocks.user },
      marketingConsent: { findUnique: mocks.consent },
      notificationOutbox: { upsert: mocks.outbox },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    },
  }
})
import {
  enqueueNotification,
  processNotificationDispatch,
  resolveNotificationType,
} from '../../../api/jobs/notification-dispatch.job'

const job = (override: Record<string, unknown> = {}) =>
  ({
    id: 'j1',
    data: {
      eventKey: 'invoice:i1',
      userId: 'u1',
      type: 'invoice_uploaded',
      title: 'Fatura',
      body: 'Fatura hazır',
      data: {
        customerName: 'Ayşe',
        orderNumber: '123',
        orderUrl: 'https://www.hanuja.com.tr/siparis/o1',
      },
      ...override,
    },
  }) as never
const emailRecord = () =>
  [...mocks.records.values()].find((r) => r.channel === 'email')!

describe('durable notification delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.records.clear()
    mocks.user.mockResolvedValue({
      id: 'u1',
      email: 'customer@example.test',
      role: 'customer',
    })
    mocks.send.mockReset().mockResolvedValue({
      messageId: '<m@test>',
      providerMessageId: 'provider-1',
      transport: 'smtp',
    })
    mocks.consent.mockResolvedValue({
      emailConsentAt: new Date(),
      emailRevokedAt: null,
    })
    mocks.create.mockResolvedValue({ id: 'n1' })
    mocks.outbox.mockImplementation(async ({ create }) => ({
      id: 'o1',
      ...create,
    }))
    mocks.upsert.mockImplementation(async ({ create }) => {
      const key = `${create.recipient}:${create.channel}:${create.eventKey}`
      if (!mocks.records.has(key))
        mocks.records.set(key, {
          id: `d${mocks.records.size}`,
          status: 'pending',
          transportStatus: 'unknown',
          attemptCount: 0,
          ...create,
        })
      return { ...mocks.records.get(key) }
    })
    mocks.update.mockImplementation(async ({ where, data }) => {
      const record = [...mocks.records.values()].find((r) => r.id === where.id)!
      Object.assign(record, data)
      return { ...record }
    })
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      const record = [...mocks.records.values()].find((r) => r.id === where.id)
      if (!record) return { count: 0 }
      if (where.status?.in && !where.status.in.includes(record.status))
        return { count: 0 }
      if (typeof where.status === 'string' && record.status !== where.status)
        return { count: 0 }
      if (where.leaseToken && record.leaseToken !== where.leaseToken)
        return { count: 0 }
      if (where.transportStatus?.not === record.transportStatus)
        return { count: 0 }
      const attempts = record.attemptCount
      Object.assign(record, data)
      if (data.attemptCount?.increment)
        record.attemptCount = attempts + data.attemptCount.increment
      return { count: 1 }
    })
  })

  it('persists queue intent without needing Redis and keeps explicit event keys', async () => {
    await enqueueNotification({
      userId: 'u1',
      type: 'invoice_uploaded',
      eventKey: 'invoice:i1',
      title: 'Fatura',
      body: 'Hazır',
    })
    expect(mocks.outbox).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_type_eventKey: {
            userId: 'u1',
            type: 'invoice_uploaded',
            eventKey: 'invoice:i1',
          },
        },
        update: {},
      }),
    )
  })
  it('normalizes legacy event names', () => {
    expect(resolveNotificationType('ORDER-CONFIRMED')).toBe('order_placed')
    expect(resolveNotificationType('bogus')).toBeNull()
  })
  it('reports unknown events and missing users instead of silently succeeding', async () => {
    await expect(
      processNotificationDispatch(job({ type: 'bogus' })),
    ).rejects.toThrow('EMAIL_EVENT_UNKNOWN')
    mocks.user.mockResolvedValue(null)
    await expect(processNotificationDispatch(job())).rejects.toThrow(
      'EMAIL_USER_MISSING',
    )
  })
  it('still discards retired seller refund events', async () => {
    await processNotificationDispatch(job({ type: 'seller_refund_completed' }))
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('resolves recipient from user, selects invoice category, retains the secure invoice link', async () => {
    await processNotificationDispatch(job())
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.test',
        fromCategory: 'fatura',
        html: expect.stringContaining('https://www.hanuja.com.tr/siparis/o1'),
        text: expect.any(String),
        replyTo: expect.any(String),
      }),
    )
    expect(emailRecord()).toMatchObject({
      status: 'sent',
      providerMessageId: 'provider-1',
      transportStatus: 'unknown',
      smtpAcceptedAt: expect.any(Date),
    })
    expect(emailRecord().deliveredAt).toBeUndefined()
  })
  it('normalizes recipients and deduplicates both channels', async () => {
    const task = job({ emailTo: ' Customer@Example.Test ' })
    await processNotificationDispatch(task)
    await processNotificationDispatch(task)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it('retries a definite SMTP rejection without repeating the in-app notification', async () => {
    mocks.send.mockRejectedValueOnce(
      Object.assign(new Error('private recipient detail'), {
        code: 'EENVELOPE',
        responseCode: 550,
      }),
    )
    await expect(processNotificationDispatch(job())).rejects.toThrow()
    expect(emailRecord()).toMatchObject({
      status: 'failed',
      lastError: 'SEND_FAILED:EENVELOPE:550',
    })
    await processNotificationDispatch(job())
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it('quarantines a connection loss after DATA instead of sending a duplicate', async () => {
    mocks.send.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), {
        code: 'ESOCKET',
        command: 'DATA',
      }),
    )
    await expect(processNotificationDispatch(job())).rejects.toThrow()
    await expect(processNotificationDispatch(job())).rejects.toThrow(
      'EMAIL_OUTCOME_UNCERTAIN',
    )
    expect(emailRecord().transportStatus).toBe('uncertain')
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('recovers an expired email claim as uncertain, never automatically re-sends', async () => {
    await processNotificationDispatch(job())
    Object.assign(emailRecord(), {
      status: 'processing',
      leaseToken: 'old',
      leaseExpiresAt: new Date(0),
    })
    await expect(processNotificationDispatch(job())).rejects.toThrow(
      'EMAIL_DELIVERY_BUSY',
    )
    expect(emailRecord().transportStatus).toBe('uncertain')
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('rejects missing template data and wrong recipient roles with observable failures', async () => {
    await expect(
      processNotificationDispatch(job({ data: { orderNumber: '123' } })),
    ).rejects.toThrow('EMAIL_DATA_MISSING:orderUrl')
    expect(emailRecord().status).toBe('failed')
    mocks.user.mockResolvedValue({
      id: 'u1',
      email: 'customer@example.test',
      role: 'seller',
    })
    // Implicit recipient of another role: in-app copy only, no e-mail attempt.
    mocks.records.clear()
    await processNotificationDispatch(job())
    expect([...mocks.records.values()].some((r) => r.channel === 'email')).toBe(false)
    expect(mocks.send).not.toHaveBeenCalled()
    // Explicitly requested address for the wrong role is still an observable failure.
    await expect(
      processNotificationDispatch(job({ emailTo: 'seller@example.test' })),
    ).rejects.toThrow('EMAIL_RECIPIENT_ROLE_MISMATCH')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('refuses unsupported email templates instead of discarding requested delivery', async () => {
    await expect(
      processNotificationDispatch(
        job({
          type: 'admin_support_new_ticket',
          emailTo: 'admin@example.test',
        }),
      ),
    ).rejects.toThrow('EMAIL_TEMPLATE_UNSUPPORTED')
    expect(emailRecord().status).toBe('failed')
  })
  it('records development simulation separately from SMTP acceptance', async () => {
    mocks.send.mockResolvedValue({
      messageId: 'dev',
      providerMessageId: null,
      transport: 'development',
    })
    await processNotificationDispatch(job())
    expect(emailRecord()).toMatchObject({
      transportStatus: 'simulated',
      smtpAcceptedAt: null,
    })
  })
  it('honors explicit replyTo', async () => {
    await processNotificationDispatch(job({ replyTo: 'reply@example.test' }))
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'reply@example.test' }),
    )
  })
  it('rechecks marketing permission and includes unsubscribe headers', async () => {
    const task = job({
      type: 'product_discount_favorited',
      emailTo: 'customer@example.test',
      data: {
        productName: 'Sehpa',
        productUrl: 'https://www.hanuja.com.tr/urun/sehpa',
        unsubscribeUrl:
          'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=test',
      },
    })
    await processNotificationDispatch(task)
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCategory: 'kampanya',
        headers: expect.objectContaining({
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }),
      }),
    )
    mocks.records.clear()
    mocks.send.mockClear()
    mocks.consent.mockResolvedValue({
      emailConsentAt: new Date(),
      emailRevokedAt: new Date(),
    })
    await processNotificationDispatch(task)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(emailRecord().transportStatus).toBe('skipped')
  })
  it('preserves deliberately in-app-only marketing notifications', async () => {
    await processNotificationDispatch(
      job({ type: 'product_discount_favorited' }),
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('e-mails only the cargo-info stage of return_status_changed and keeps other stages in-app', async () => {
    const item = { productName: 'Gea', quantity: 1, unitPrice: '10 TL', lineTotal: '10 TL' }
    await processNotificationDispatch(
      job({
        eventKey: 'return:r1:seller:in-transit',
        type: 'return_status_changed',
        data: { stage: 'customer_shipped', orderNumber: '123', items: [item] },
      }),
    )
    expect(mocks.send).not.toHaveBeenCalled()
    expect([...mocks.records.values()].some((r) => r.channel === 'email')).toBe(false)
    await processNotificationDispatch(
      job({
        eventKey: 'return:r1:customer:cargo-info',
        type: 'return_status_changed',
        data: {
          stage: 'cargo_info_ready',
          orderNumber: '123',
          customerName: 'Ayşe',
          cargoAddress: 'Kadıköy',
          cargoCarrier: 'Aras',
          items: [item],
        },
      }),
    )
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'İade Talebiniz Kabul Edildi — Ürünü Kargoya Verin — #123',
      }),
    )
  })
  it('renders the phase 2 customer lifecycle templates', async () => {
    const item = { productName: 'Gea', quantity: 1, unitPrice: '10 TL', lineTotal: '10 TL' }
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        'order_cancelled',
        { orderNumber: '123', customerName: 'Ayşe', actorRole: 'admin', partial: false, items: [item] },
        'Siparişiniz İptal Edilmiştir — #123',
      ],
      [
        'order_delivery_confirmed',
        { orderNumber: '123', customerName: 'Ayşe', partial: true, items: [item] },
        'Siparişinizin Bir Kısmı Teslim Edildi — #123',
      ],
      [
        'order_return_approved',
        {
          orderNumber: '123',
          customerName: 'Ayşe',
          decision: 'partial',
          items: [{ ...item, acceptedQuantity: 1, rejectedQuantity: 0 }],
        },
        'İade Talebiniz Kısmen Kabul Edildi — #123',
      ],
      [
        'order_return_rejected',
        {
          orderNumber: '123',
          customerName: 'Ayşe',
          decision: 'rejected',
          disputeOpened: true,
          items: [{ ...item, acceptedQuantity: 0, rejectedQuantity: 1, rejectionReason: 'Kullanılmış' }],
        },
        'İade Talebiniz Reddedildi — #123',
      ],
    ]
    for (const [type, data, subject] of cases) {
      mocks.records.clear()
      mocks.send.mockClear()
      await processNotificationDispatch(job({ eventKey: `case:${type}`, type, data }))
      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ subject }))
    }
  })
  it('fails observably when a decision e-mail has an unknown decision value', async () => {
    await expect(
      processNotificationDispatch(
        job({
          eventKey: 'bad-decision',
          type: 'order_return_approved',
          data: { orderNumber: '123', decision: 'maybe', items: [{ productName: 'x', quantity: 1 }] },
        }),
      ),
    ).rejects.toThrow('EMAIL_TEMPLATE_UNSUPPORTED')
    expect(emailRecord().status).toBe('failed')
  })
})
