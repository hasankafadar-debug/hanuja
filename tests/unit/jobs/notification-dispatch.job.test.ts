import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findUniqueMock,
  createMock,
  sendEmailMock,
  queueAddMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  sendEmailMock: vi.fn(),
  queueAddMock: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
}))

vi.mock('../../../api/lib/redis', () => ({
  redis: {},
}))

vi.mock('../../../api/lib/queue', () => ({
  QUEUE_NAMES: { NOTIFICATION_DISPATCH: 'notification-dispatch' },
  notificationDispatchQueue: { add: queueAddMock },
}))

vi.mock('../../../api/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
    },
    notification: {
      create: createMock,
    },
  },
}))

vi.mock('../../../api/lib/mailer', () => ({
  sendEmail: sendEmailMock,
}))

import {
  enqueueNotification,
  processNotificationDispatch,
  resolveNotificationType,
} from '../../../api/jobs/notification-dispatch.job'

describe('notification-dispatch.job', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    createMock.mockReset()
    sendEmailMock.mockReset()
    queueAddMock.mockReset()
  })

  it('canonicalizes legacy order_confirmed notifications before persisting', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-1',
      data: {
        userId: 'user-1',
        type: 'order_confirmed',
        title: 'Sipariş alındı',
        body: 'Body',
      },
    } as never)

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'order_placed',
      }),
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips invalid notification types without creating a record', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await processNotificationDispatch({
      id: 'job-2',
      data: {
        userId: 'user-1',
        type: 'definitely_invalid',
        title: 'Invalid',
        body: 'Body',
      },
    } as never)

    expect(createMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('skips notifications for missing users instead of failing the job', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    findUniqueMock.mockResolvedValue(null)

    await processNotificationDispatch({
      id: 'job-3',
      data: {
        userId: 'missing-user',
        type: 'order_payment_confirmed',
        title: 'Missing user',
        body: 'Body',
      },
    } as never)

    expect(createMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('queues notifications with retries intact', async () => {
    await enqueueNotification({
      userId: 'user-1',
      type: 'order_payment_confirmed',
      title: 'Queued',
      body: 'Body',
    })

    expect(queueAddMock).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ type: 'order_payment_confirmed' }),
      expect.objectContaining({ attempts: 3 }),
    )
  })

  it('resolves canonical and legacy notification types', () => {
    expect(resolveNotificationType('order_payment_confirmed')).toBe('order_payment_confirmed')
    expect(resolveNotificationType('order_confirmed')).toBe('order_placed')
  })
})
