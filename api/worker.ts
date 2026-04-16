/**
 * Worker process entry point — runs all BullMQ workers.
 *
 * This must run as a SEPARATE process from the Next.js apps.
 * In development: `pnpm worker`
 * In production (Coolify): start as a separate container/process alongside the API.
 *
 * Workers managed here:
 *  - payout-maturity        — releases payout holds after 30-day countdown
 *  - delivery-silent-confirm — auto-confirms delivery after 72h without customer objection
 *  - search-index-sync      — syncs published products to Meilisearch
 *  - notification-dispatch  — sends in-app + email notifications
 *  - payout-batch           — prepares and executes scheduled payout batches
 *  - media-processing       — verifies R2 uploads post-confirmation
 *  - fulfillment-risk       — flags orders approaching 20-day fulfillment breach
 */
import 'dotenv/config'
import { startAllWorkers, gracefulShutdown } from './jobs'

async function main() {
  console.log('[worker] Starting Hanuja BullMQ workers...')

  const workers = startAllWorkers()

  async function shutdown(signal: string) {
    console.log(`[worker] Received ${signal} — shutting down gracefully...`)
    await gracefulShutdown(workers)
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  console.log('[worker] All workers running. Waiting for jobs...')
}

main().catch((err) => {
  console.error('[worker] Fatal startup error:', err)
  process.exit(1)
})
