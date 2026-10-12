import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { sweepSellerInvoiceReminders } from '../services/seller-invoice-reminder.service'

/** Reminds sellers whose invoice to Hanuja is still missing an hour after shipment. */
export function startSellerInvoiceReminderWorker() {
  const worker = new Worker(
    QUEUE_NAMES.SELLER_INVOICE_REMINDER,
    async () => {
      const result = await sweepSellerInvoiceReminders({ prisma })
      if (result.reminded) console.info('[seller-invoice-reminder]', result)
      return result
    },
    { connection: redis, concurrency: 1 },
  )
  worker.on('failed', (job, error) =>
    console.error(`[seller-invoice-reminder] Job ${job?.id} failed:`, error),
  )
  return worker
}
