/**
 * Worker entrypoint — runs in a separate process in production.
 * Started by Dockerfile.worker via: node --import tsx/esm api/jobs/worker-entrypoint.ts
 */
import { validateEnv } from '@hanuja/config/env'
import { startAllWorkers, gracefulShutdown } from './index'
import { scheduleRepeatableJobs } from './schedule-repeatable-jobs'

async function main() {
  validateEnv()
  console.log('[worker] Starting Hanuja BullMQ workers...')

  // Register repeatable (cron) jobs before starting workers.
  // Safe to call on every restart — BullMQ deduplicates by key.
  await scheduleRepeatableJobs()

  const workers = await startAllWorkers()

  async function shutdown(signal: string) {
    console.log(`[worker] Received ${signal}, shutting down...`)
    await gracefulShutdown(workers)
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err)
  process.exit(1)
})
