import { Queue } from 'bullmq'
import { getRedis } from './redis'

export const QUEUE_NAMES = {
  PAYOUT_MATURITY: 'payout-maturity',
  DELIVERY_SILENT_CONFIRM: 'delivery-silent-confirmation',
  RECONCILIATION: 'reconciliation',
  FULFILLMENT_RISK: 'fulfillment-risk',
  SEARCH_INDEX_SYNC: 'search-index-sync',
  NOTIFICATION_DISPATCH: 'notification-dispatch',
  MEDIA_PROCESSING: 'media-processing',
  PAYOUT_BATCH: 'payout-batch',
  IBAN_ACTIVATION: 'iban-activation',
  SEO_CONTENT: 'seo-content',
  CAMPAIGN_DISCOUNT: 'campaign-discount',
  REFUND_PROCESSING: 'refund-processing',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

const globalForQueues = globalThis as unknown as {
  queues?: Partial<Record<QueueName, Queue>>
}

function getQueue(name: QueueName): Queue {
  const queues = (globalForQueues.queues ??= {})
  const existing = queues[name]

  if (existing) {
    return existing
  }

  const queue = new Queue(name, { connection: getRedis() })
  queues[name] = queue
  return queue
}

function createQueueProxy(name: QueueName): Queue {
  return new Proxy({} as Queue, {
    get(_target, prop) {
      const queue = getQueue(name)
      const value = Reflect.get(queue as object, prop, queue)
      return typeof value === 'function' ? value.bind(queue) : value
    },
  })
}

// All queues use the same Redis connection.
// Workers are defined separately in api/jobs/.
export const payoutMaturityQueue = createQueueProxy(QUEUE_NAMES.PAYOUT_MATURITY)
export const deliverySilentConfirmQueue = createQueueProxy(QUEUE_NAMES.DELIVERY_SILENT_CONFIRM)
export const reconciliationQueue = createQueueProxy(QUEUE_NAMES.RECONCILIATION)
export const searchIndexSyncQueue = createQueueProxy(QUEUE_NAMES.SEARCH_INDEX_SYNC)
export const notificationDispatchQueue = createQueueProxy(QUEUE_NAMES.NOTIFICATION_DISPATCH)
export const mediaProcessingQueue = createQueueProxy(QUEUE_NAMES.MEDIA_PROCESSING)
export const payoutBatchQueue = createQueueProxy(QUEUE_NAMES.PAYOUT_BATCH)
export const fulfillmentRiskQueue = createQueueProxy(QUEUE_NAMES.FULFILLMENT_RISK)
export const ibanActivationQueue = createQueueProxy(QUEUE_NAMES.IBAN_ACTIVATION)
export const seoContentQueue = createQueueProxy(QUEUE_NAMES.SEO_CONTENT)
export const campaignDiscountQueue = createQueueProxy(QUEUE_NAMES.CAMPAIGN_DISCOUNT)
export const refundProcessingQueue = createQueueProxy(QUEUE_NAMES.REFUND_PROCESSING)
