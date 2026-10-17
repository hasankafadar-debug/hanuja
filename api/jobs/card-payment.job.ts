import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { createCardPaymentService } from '../services/card-payment.service'
import { createRefundExecutionService } from '../services/refund-execution.service'

/**
 * Kart ödemesi işleri:
 * - 'maintenance' (5 dk): süresi dolan ödenmemiş siparişler, sonucu belirsiz denemeler,
 *   yarım geri ödemeler, işlenmemiş webhook kayıtları ve kuyruktan düşmüş/belirsiz kart iadeleri.
 * - 'webhook': kalıcı olarak kaydedilmiş bir iyzico bildiriminin işlenmesi.
 */
export function startCardPaymentWorker() {
  const worker = new Worker(
    QUEUE_NAMES.CARD_PAYMENT,
    async (job) => {
      const service = createCardPaymentService({ prisma })
      if (job.name === 'webhook') {
        const eventId = (job.data as { eventId?: unknown }).eventId
        if (typeof eventId === 'string') await service.processWebhookEvent(eventId)
        return { eventId }
      }
      const summary = await service.runMaintenance()
      // Sipariş iadeleri: kuyruğa alınamamış / belirsiz kart iadeleri (iyzico raporuyla).
      const refunds = await createRefundExecutionService({ prisma }).sweepCardRefunds()
      if ([...Object.values(summary), ...Object.values(refunds)].some((value) => value > 0)) {
        console.info('[card-payment] maintenance', { ...summary, refunds })
      }
      return { ...summary, refunds }
    },
    { connection: redis, concurrency: 1 },
  )
  worker.on('failed', (job, error) =>
    console.error(`[card-payment] Job ${job?.id} (${job?.name}) failed:`, error.message),
  )
  return worker
}
