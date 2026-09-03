/**
 * Job worker registry — start all workers from a single entry point.
 * In production, this runs in a separate process from the Next.js apps.
 */
import { startPayoutMaturityWorker } from './payout-maturity.job'
import { startDeliverySilentConfirmWorker } from './delivery-silent-confirmation.job'
import { startSearchIndexSyncWorker } from './search-index-sync.job'
import { startNotificationDispatchWorker } from './notification-dispatch.job'
import { startPayoutBatchWorker } from './payout-batch.job'
import { startMediaProcessingWorker } from './media-processing.job'
import { startFulfillmentRiskWorker } from './fulfillment-risk.job'
import { startIbanActivationWorker } from './iban-activation.job'
import { startSeoContentWorker } from './seo-content.job'
import { startCampaignDiscountWorker } from './campaign-discount.job'
import { startRefundProcessingWorker } from './refund-processing.job'

export function startAllWorkers() {
  const workers = [
    startPayoutMaturityWorker(),
    startDeliverySilentConfirmWorker(),
    startSearchIndexSyncWorker(),
    startNotificationDispatchWorker(),
    startPayoutBatchWorker(),
    startMediaProcessingWorker(),
    startFulfillmentRiskWorker(),
    startIbanActivationWorker(),
    startSeoContentWorker(),
    startCampaignDiscountWorker(),
    startRefundProcessingWorker(),
  ]

  console.log(`[workers] Started ${workers.length} BullMQ workers`)
  return workers
}

export async function gracefulShutdown(workers: Awaited<ReturnType<typeof startAllWorkers>>) {
  console.log('[workers] Shutting down gracefully...')
  await Promise.all(workers.map((w) => w.close()))
  console.log('[workers] All workers stopped')
}
