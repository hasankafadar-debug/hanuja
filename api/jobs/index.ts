import { startReturnDeadlineWorker } from './return-deadline.job'
/**
 * Job worker registry — start all workers from a single entry point.
 * In production, this runs in a separate process from the Next.js apps.
 */
import { startPayoutMaturityWorker } from './payout-maturity.job'
import { startSearchIndexSyncWorker } from './search-index-sync.job'
import {
  startNotificationDispatchWorker,
  startNotificationBulkWorker,
} from './notification-dispatch.job'
import { startNotificationOutboxWorker } from './notification-outbox.job'
import { startPayoutBatchWorker } from './payout-batch.job'
import { startMediaProcessingWorker } from './media-processing.job'
import { startFulfillmentRiskWorker } from './fulfillment-risk.job'
import { startIbanActivationWorker } from './iban-activation.job'
import { startSeoContentWorker } from './seo-content.job'
import { startCampaignDiscountWorker } from './campaign-discount.job'
import { startRefundProcessingWorker } from './refund-processing.job'
import { startAnnouncementDispatchWorker } from './announcement-dispatch.job'
import { startPriceHistoryWorker } from './price-history.job'
import { startPrivateDocumentCleanupWorker } from './private-document-cleanup.job'
import { startSellerInvoiceReminderWorker } from './seller-invoice-reminder.job'

export function startAllWorkers() {
  const workers = [
    startPayoutMaturityWorker(),
    startSearchIndexSyncWorker(),
    startNotificationDispatchWorker(),
    startNotificationBulkWorker(),
    startNotificationOutboxWorker(),
    startPayoutBatchWorker(),
    startMediaProcessingWorker(),
    startFulfillmentRiskWorker(),
    startIbanActivationWorker(),
    startSeoContentWorker(),
    startCampaignDiscountWorker(),
    startRefundProcessingWorker(),
    startAnnouncementDispatchWorker(),
    startPriceHistoryWorker(),
    startPrivateDocumentCleanupWorker(),
    startSellerInvoiceReminderWorker(),
    startReturnDeadlineWorker(),
  ]

  console.log(`[workers] Started ${workers.length} BullMQ workers`)
  return workers
}

export async function gracefulShutdown(workers: Awaited<ReturnType<typeof startAllWorkers>>) {
  console.log('[workers] Shutting down gracefully...')
  await Promise.all(workers.map((w) => w.close()))
  console.log('[workers] All workers stopped')
}
