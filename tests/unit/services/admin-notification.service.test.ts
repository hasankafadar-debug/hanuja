import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recordNotificationMock } = vi.hoisted(() => ({
  recordNotificationMock: vi.fn(),
}))

vi.mock('../../../api/services/notification-outbox.service', () => ({
  recordNotification: recordNotificationMock,
}))

import {
  ADMIN_NOTIFICATION_EVENTS,
  adminPanelLink,
  isAdminNotificationEvent,
  recordAdminOperationNotification,
  resolveAdminRecipient,
} from '../../../api/services/admin-notification.service'
import { ADMIN_OPERATION_TYPES } from '../../../api/lib/notification-policy'

function buildTx(email: string | null = 'ops@hanuja.com.tr') {
  return {
    adminNotificationRecipient: {
      findUnique: vi.fn().mockResolvedValue(email === null ? null : { email }),
    },
    notificationOutbox: { upsert: vi.fn() },
  }
}

describe('admin operation notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('resolves the configured mailbox per event', async () => {
    const tx = buildTx('finans@hanuja.com.tr')
    await expect(resolveAdminRecipient(tx as never, 'eft_pending')).resolves.toBe(
      'finans@hanuja.com.tr',
    )
    expect(tx.adminNotificationRecipient.findUnique).toHaveBeenCalledWith({
      where: { event: 'eft_pending' },
      select: { email: true },
    })
  })

  it('falls back to the platform support mailbox when no row exists', async () => {
    const tx = buildTx(null)
    await expect(
      resolveAdminRecipient(tx as never, 'dispute_opened'),
    ).resolves.toBe('admin@hanuja.com.tr')
  })

  it('writes the outbox row with the reserved ops recipient and the resolved address', async () => {
    const tx = buildTx()
    await recordAdminOperationNotification(tx as never, {
      event: 'dispute_opened',
      type: 'admin_dispute_opened',
      eventKey: 'dispute:d-1:ops',
      title: 'Uyuşmazlık',
      body: 'gövde',
      data: { orderNumber: '26050042', adminUrl: 'https://admin.hanuja.com.tr/x' },
    })

    expect(recordNotificationMock).toHaveBeenCalledTimes(1)
    const [client, payload] = recordNotificationMock.mock.calls[0]!
    expect(client).toBe(tx)
    expect(payload).toMatchObject({
      userId: 'ops',
      emailTo: 'ops@hanuja.com.tr',
      type: 'admin_dispute_opened',
      eventKey: 'dispute:d-1:ops',
    })
  })

  it('refuses a type that is not a declared operation type', async () => {
    const tx = buildTx()
    await expect(
      recordAdminOperationNotification(tx as never, {
        event: 'dispute_opened',
        // Not an operation type: it must never reach the ops mailbox path.
        type: 'order_placed' as never,
        eventKey: 'x',
        title: 't',
        body: 'b',
        data: {},
      }),
    ).rejects.toThrow('EMAIL_OPS_TYPE_NOT_ALLOWED')
    expect(recordNotificationMock).not.toHaveBeenCalled()
  })

  it('does not swallow a recipient lookup failure', async () => {
    const tx = {
      adminNotificationRecipient: {
        findUnique: vi.fn().mockRejectedValue(new Error('DB_DOWN')),
      },
      notificationOutbox: { upsert: vi.fn() },
    }
    await expect(
      recordAdminOperationNotification(tx as never, {
        event: 'eft_pending',
        type: 'admin_bank_transfer_pending',
        eventKey: 'order:o-1:eft-pending',
        title: 't',
        body: 'b',
        data: {},
      }),
    ).rejects.toThrow('DB_DOWN')
    expect(recordNotificationMock).not.toHaveBeenCalled()
  })

  it('keeps the seven configurable events and the eight operation types in sync', () => {
    expect(ADMIN_NOTIFICATION_EVENTS).toHaveLength(7)
    // Support is one configurable event with two notification types.
    expect(ADMIN_OPERATION_TYPES.size).toBe(8)
    expect(isAdminNotificationEvent('support_ticket')).toBe(true)
    expect(isAdminNotificationEvent('unknown_event')).toBe(false)
  })

  it('builds absolute admin panel links', () => {
    expect(adminPanelLink('/uyusmazliklar/d-1')).toBe(
      'https://admin.hanuja.com.tr/uyusmazliklar/d-1',
    )
    expect(adminPanelLink('odemeler')).toBe('https://admin.hanuja.com.tr/odemeler')
  })
})
