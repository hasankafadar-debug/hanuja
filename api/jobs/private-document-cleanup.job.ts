import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { processPrivateDocumentCleanup } from '../services/private-document-cleanup.service'

export function startPrivateDocumentCleanupWorker() {
  const worker = new Worker(
    QUEUE_NAMES.PRIVATE_DOCUMENT_CLEANUP,
    async () => {
      const result = await processPrivateDocumentCleanup()
      if (result.processed) console.info('[private-document-cleanup]', result)
      return result
    },
    { connection: redis, concurrency: 1 },
  )
  worker.on('failed', () =>
    console.error('[private-document-cleanup] Sweep failed; durable intents retained.'),
  )
  return worker
}
