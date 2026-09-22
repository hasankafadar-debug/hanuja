import { describe, expect, it, vi } from 'vitest'
import { createNotificationOperationsService } from '../../../api/services/notification-operations.service'

describe('notification operations authorization and retries', () => {
  function database(role = 'admin') {
    const tx = {
      notificationDelivery: {
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      notificationOutbox: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      adminAuditLog: { create: vi.fn() },
    }
    return {
      ...tx,
      user: { findUnique: vi.fn().mockResolvedValue({ role }) },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    }
  }
  it.each(['customer', 'seller'])(
    'rejects %s access to listing and retries',
    async (role) => {
      const service = createNotificationOperationsService(
        database(role) as never,
      )
      await expect(service.list('u1')).rejects.toThrow()
      await expect(
        service.retry('u1', 'd1', 'Gerekçe en az on karakter', 'delivery'),
      ).rejects.toThrow()
    },
  )
  it.each([
    { status: 'sent', transportStatus: 'unknown', payload: {} },
    { status: 'failed', transportStatus: 'uncertain', payload: {} },
    { status: 'failed', transportStatus: 'unknown', payload: null },
  ])(
    'blocks successful, uncertain and unreconstructable legacy delivery: %j',
    async (row) => {
      const db = database()
      db.notificationDelivery.findUnique.mockResolvedValue(row)
      await expect(
        createNotificationOperationsService(db as never).retry(
          'a1',
          'd1',
          'SMTP ayarı düzeltildi',
          'delivery',
        ),
      ).rejects.toThrow()
      expect(db.adminAuditLog.create).not.toHaveBeenCalled()
    },
  )
  it('requeues a failed event in a new generation and appends the admin audit', async () => {
    const db = database()
    db.notificationOutbox.findUnique.mockResolvedValue({
      id: 'o1',
      generation: 0,
      status: 'failed',
      eventKey: 'event1',
      userId: 'u1',
    })
    await createNotificationOperationsService(db as never).retry(
      'a1',
      'o1',
      'SMTP ayarı düzeltildi',
      'outbox',
    )
    expect(db.notificationOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generation: { increment: 1 },
          status: 'pending',
        }),
      }),
    )
    expect(db.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'a1',
          actionType: 'notification_retry_requested',
        }),
      }),
    )
  })
})
