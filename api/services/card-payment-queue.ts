import { cardPaymentQueue } from '../lib/queue'

/**
 * Webhook kaydı DB'ye yazıldıktan sonra çağrılır. Kuyruk hatası kaydı kaybettirmez:
 * card-payment bakım işi işlenmemiş kayıtları tarar.
 */
export async function enqueueIyzicoWebhookEvent(eventId: string) {
  await cardPaymentQueue.add(
    'webhook',
    { eventId },
    {
      jobId: `iyzico-webhook-${eventId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  )
}
