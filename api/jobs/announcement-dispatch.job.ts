/**
 * Announcement dispatch worker (e-mail plan phase 5). A 15 s repeatable tick that
 * materialises announcement recipients into the notification outbox and requeues
 * bulk retries within the bulk lane's capacity. Separate from the relay worker, so
 * order e-mails never wait for it; a tick that times out is retried on the next one.
 */
import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'

export function startAnnouncementDispatchWorker() {
  const worker = new Worker(
    QUEUE_NAMES.ANNOUNCEMENT_DISPATCH,
    async () => {
      const { prisma } = await import('../lib/prisma')
      const { runAnnouncementDispatchSweep } = await import(
        '../services/announcement-dispatch.service'
      )
      try {
        return await runAnnouncementDispatchSweep(prisma)
      } catch (error) {
        // Lock/statement timeouts roll the tick back; recipients stay pending for the next one.
        const code = (error as { code?: unknown } | null)?.code
        console.warn('[announcement-dispatch] tick rolled back; retried on the next tick', {
          code: typeof code === 'string' ? code : 'UNKNOWN',
        })
        return { skipped: 'error' as const }
      }
    },
    { connection: redis, concurrency: 1 },
  )
  worker.on('failed', () =>
    console.error('[announcement-dispatch] tick failed; recipients retained.'),
  )
  return worker
}
