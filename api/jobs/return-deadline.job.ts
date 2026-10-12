import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { QUEUE_NAMES } from '../lib/queue'
import { sweepReturnDeadlines } from '../services/return-deadline.service'

export function startReturnDeadlineWorker() {
  return new Worker(QUEUE_NAMES.RETURN_DEADLINE, () => sweepReturnDeadlines(prisma), { connection: redis, concurrency: 1 })
}
