import { Queue } from 'bullmq'
import { redis } from './redis'

export const QUEUE_NAMES = {
  PAYOUT_MATURITY: 'payout-maturity',
  DELIVERY_SILENT_CONFIRM: 'delivery-silent-confirmation',
  RECONCILIATION: 'reconciliation',
  FULFILLMENT_RISK: 'fulfillment-risk',
  SEARCH_INDEX_SYNC: 'search-index-sync',
  NOTIFICATION_DISPATCH: 'notification-dispatch',
  MEDIA_PROCESSING: 'media-processing',
  PAYOUT_BATCH: 'payout-batch',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

const connection = redis

// All queues use the same Redis connection.
// Workers are defined separately in api/jobs/.
export const payoutMaturityQueue = new Queue(QUEUE_NAMES.PAYOUT_MATURITY, { connection })
export const deliverySilentConfirmQueue = new Queue(QUEUE_NAMES.DELIVERY_SILENT_CONFIRM, {
  connection,
})
export const reconciliationQueue = new Queue(QUEUE_NAMES.RECONCILIATION, { connection })
export const searchIndexSyncQueue = new Queue(QUEUE_NAMES.SEARCH_INDEX_SYNC, { connection })
export const notificationDispatchQueue = new Queue(QUEUE_NAMES.NOTIFICATION_DISPATCH, {
  connection,
})
export const mediaProcessingQueue = new Queue(QUEUE_NAMES.MEDIA_PROCESSING, { connection })
export const payoutBatchQueue = new Queue(QUEUE_NAMES.PAYOUT_BATCH, { connection })
export const fulfillmentRiskQueue = new Queue(QUEUE_NAMES.FULFILLMENT_RISK, { connection })
