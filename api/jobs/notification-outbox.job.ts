import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { relayNotifications } from '../services/notification-outbox.service'

export function startNotificationOutboxWorker() {
  const worker = new Worker(
    QUEUE_NAMES.NOTIFICATION_OUTBOX,
    async () => {
      const { prisma } = await import('../lib/prisma')
      await relayNotifications(prisma)
    },
    { connection: redis, concurrency: 1 },
  )
  worker.on('failed', () =>
    console.error(
      '[notification-outbox] Relay failed; durable events retained.',
    ),
  )
  return worker
}
