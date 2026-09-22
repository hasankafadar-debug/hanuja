/** Read-only diagnosis. Never sends mail, replays jobs or prints secret values. */
import 'dotenv/config'
import {
  assertProductionMailConfig,
  isValidFromAddress,
} from '../../api/lib/mailer'
import { prisma } from '../../api/lib/prisma'
import {
  notificationDispatchQueue,
  notificationBulkQueue,
  notificationOutboxQueue,
} from '../../api/lib/queue'
import { getRedis } from '../../api/lib/redis'
import { notificationErrorCode } from '../../api/lib/notification-policy'

async function main() {
  for (const key of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'EMAIL_FROM_NOREPLY',
    'EMAIL_FROM_FATURA',
    'EMAIL_FROM_KAMPANYA',
    'RESEND_WEBHOOK_SECRET',
  ]) {
    const value = process.env[key]?.trim()
    console.log(
      key,
      value
        ? key.includes('FROM') && !isValidFromAddress(value)
          ? 'INVALID_ADDRESS'
          : 'SET'
        : 'UNSET',
    )
  }
  try {
    assertProductionMailConfig()
  } catch (error) {
    console.error(notificationErrorCode(error))
    process.exitCode = 1
  }
  console.log(
    'outbox',
    await prisma.notificationOutbox.groupBy({
      by: ['status', 'lane'],
      _count: true,
    }),
  )
  console.log(
    'deliveries',
    await prisma.notificationDelivery.groupBy({
      by: ['channel', 'status', 'transportStatus'],
      _count: true,
    }),
  )
  for (const queue of [
    notificationDispatchQueue,
    notificationBulkQueue,
    notificationOutboxQueue,
  ]) {
    console.log(
      queue.name,
      await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      ),
    )
    const jobs = await queue.getJobs(['failed'], 0, 49)
    console.log(
      'failed-preview',
      jobs.map((job) => ({
        jobId: job.id,
        type: job.data.type ?? job.name,
        attempts: job.attemptsMade,
        hasEventKey: !!job.data.eventKey,
        hasPayload: !!job.data.data,
      })),
    )
  }
}

// A broken Redis connection must not hang an operator's terminal indefinitely.
const timeout = setTimeout(() => {
  console.error('NOTIFICATION_DIAGNOSIS_TIMEOUT')
  process.exit(1)
}, 20_000)
main()
  .catch(() => {
    console.error('NOTIFICATION_DIAGNOSIS_FAILED')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await Promise.all(
      [
        notificationDispatchQueue,
        notificationBulkQueue,
        notificationOutboxQueue,
      ].map((queue) => queue.close()),
    )
    getRedis().disconnect()
    clearTimeout(timeout)
  })
